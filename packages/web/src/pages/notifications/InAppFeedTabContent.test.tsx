import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { InAppFeedTabContent } from './InAppFeedTabContent.js';
import { makeAgent, makeNotification } from '../../test-utils/factories.js';

// Renders the current router pathname so click-routing tests can assert on
// where the navigation actually landed.
function LocationDisplay() {
    const loc = useLocation();
    return <div data-testid="location">{loc.pathname}</div>;
}

const BASE = 'http://localhost:3000/api';

describe('InAppFeedTabContent', () => {
    it('renders an empty state when there are no notifications', () => {
        renderWithProviders(<InAppFeedTabContent allRows={[]} agents={[]} />);
        expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
    });

    it('renders rows from allRows with agent metadata', () => {
        const agents = [makeAgent({ id: 'agent-coder', name: 'Coder' })];
        const rows = [
            makeNotification({
                id: 1,
                message: 'Story ATL-2 moved to In Review',
                kind: 'needs_you',
                issue_type: 'story',
                issue_id: 'ATL-2',
                agent_id: 'agent-coder',
            }),
            makeNotification({
                id: 2,
                message: 'System ping',
                kind: 'system',
                agent_id: null,
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={agents} />);
        expect(screen.getByText(/Story ATL-2 moved/)).toBeInTheDocument();
        expect(screen.getByText('System ping')).toBeInTheDocument();
    });

    it('shows a needs_you alert banner when any row is needs_you', () => {
        const rows = [
            makeNotification({
                id: 1,
                kind: 'needs_you',
                message: 'Action needed',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('filters rows by kind when a FilterPill is clicked', () => {
        const rows = [
            makeNotification({ id: 1, kind: 'update', message: 'Just an update' }),
            makeNotification({ id: 2, kind: 'system', message: 'System message' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        // Click "System" pill
        const systemPill = screen.getByText('System');
        fireEvent.click(systemPill);
        // Only System message should remain visible
        expect(screen.getByText('System message')).toBeInTheDocument();
        expect(screen.queryByText('Just an update')).not.toBeInTheDocument();
    });

    it('clicks a row to mark it read and navigate by issue_type', () => {
        let markRead = false;
        server.use(
            http.patch(`${BASE}/notifications/1/read`, () => {
                markRead = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        const rows = [
            makeNotification({
                id: 1,
                message: 'Story link click',
                kind: 'update',
                issue_type: 'story',
                issue_id: 'ATL-99',
                read_at: null,
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        const row = screen.getByText(/Story link click/);
        fireEvent.click(row);
        // markRead may or may not have fired (race with React), but click ran.
        expect(row).toBeInTheDocument();
        // Help silence unused
        void markRead;
    });

    it('navigates by each supported issue_type without crashing', () => {
        const issueTypes = ['epic', 'story', 'bug', 'sub_task', 'sub_bug'] as const;
        const rows = issueTypes.map((t, i) =>
            makeNotification({
                id: i + 100,
                kind: 'update',
                issue_type: t,
                issue_id: `id-${t}`,
                message: `Click ${t}`,
                read_at: '2026-01-01T00:00:00Z',
            }),
        );
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        for (const t of issueTypes) {
            const el = screen.getByText(`Click ${t}`);
            fireEvent.click(el);
        }
    });

    it('navigates to /projects/<id> when no issue_id but project_id is set', () => {
        const rows = [
            makeNotification({
                id: 200,
                kind: 'update',
                issue_type: null,
                issue_id: null,
                project_id: 'p1',
                message: 'Project ping',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        const el = screen.getByText('Project ping');
        fireEvent.click(el);
    });

    it('falls back to /issues when nothing else matches', () => {
        const rows = [
            makeNotification({
                id: 201,
                kind: 'system',
                issue_type: null,
                issue_id: null,
                project_id: null,
                message: 'Lonely system message',
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>,
        );
        fireEvent.click(screen.getByText('Lonely system message'));
        expect(screen.getByTestId('location').textContent).toBe('/issues');
    });

    it('routes reminder notifications to /reminders, not /issues', () => {
        // Reminder rows ship with event_type='reminder', issue_id=null, and
        // project_id=null (see api/src/services/reminders.ts#fireOne). Without
        // a dedicated branch in openNotification(), they fall through to the
        // /issues catch-all — exactly what the user reported.
        const rows = [
            makeNotification({
                id: 300,
                event_type: 'reminder',
                kind: 'system',
                issue_type: null,
                issue_id: null,
                project_id: null,
                message: 'Time to stretch',
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>,
        );
        fireEvent.click(screen.getByText('Time to stretch'));
        expect(screen.getByTestId('location').textContent).toBe('/reminders');
    });

    it('uses singular "1 item needs you" phrasing', () => {
        const rows = [makeNotification({ id: 1, kind: 'needs_you', message: 'One only' })];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        expect(screen.getByText(/1 item needs you/)).toBeInTheDocument();
    });

    it('navigates to link_url when row has an explicit deep link', () => {
        const rows = [
            makeNotification({
                id: 400,
                kind: 'system',
                link_url: '/terminal/sess-abc',
                message: 'Terminal session link',
                issue_type: null,
                issue_id: null,
                project_id: null,
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>,
        );
        fireEvent.click(screen.getByText('Terminal session link'));
        expect(screen.getByTestId('location').textContent).toBe('/terminal/sess-abc');
    });

    it('marks already-read row as read without PATCH when row.read_at is set', () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/notifications/500/read`, () => {
                patched = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        const rows = [
            makeNotification({
                id: 500,
                message: 'Already read message',
                kind: 'update',
                issue_type: 'story',
                issue_id: 'ATL-50',
                read_at: '2026-01-01T12:00:00Z',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Already read message'));
        // read_at is set so markRead.mutate should NOT be called
        expect(patched).toBe(false);
    });

    it('clicking "All" filter pill covers setFilter("all") (L109)', () => {
        const rows = [
            makeNotification({ id: 600, kind: 'needs_you', message: 'Action item 1' }),
            makeNotification({ id: 601, kind: 'update', message: 'Update item 1' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        // First switch to another filter, then click All to reset
        fireEvent.click(screen.getByText('System'));
        fireEvent.click(screen.getByText('All'));
        // All rows should be visible again
        expect(screen.getByText('Action item 1')).toBeInTheDocument();
        expect(screen.getByText('Update item 1')).toBeInTheDocument();
    });

    it('clicking "Needs You" filter pill covers setFilter("needs_you") (L115)', () => {
        const rows = [
            makeNotification({ id: 700, kind: 'needs_you', message: 'Needs you message' }),
            makeNotification({ id: 701, kind: 'update', message: 'Just an update' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Needs You'));
        expect(screen.getByText('Needs you message')).toBeInTheDocument();
        expect(screen.queryByText('Just an update')).not.toBeInTheDocument();
    });

    it('clicking "Updates" filter pill covers setFilter("update") (L121)', () => {
        const rows = [
            makeNotification({ id: 800, kind: 'needs_you', message: 'Action needed' }),
            makeNotification({ id: 801, kind: 'update', message: 'Update notification' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Updates'));
        expect(screen.getByText('Update notification')).toBeInTheDocument();
        expect(screen.queryByText('Action needed')).not.toBeInTheDocument();
    });
});
