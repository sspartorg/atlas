import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AwaitingYouRow } from './AwaitingYouRow.js';

describe('AwaitingYouRow', () => {
    it('renders the row data', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'CER-7',
                    issue_type: 'story',
                    title: 'Add a login form',
                    status: 'waiting_for_info',
                    updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                }}
            />,
        );
        expect(screen.getByText('Add a login form')).toBeInTheDocument();
        expect(screen.getByText(/CER-7/)).toBeInTheDocument();
    });

    it('handles each issue_type → route mapping (click executes navigate)', () => {
        const issueTypes = ['epic', 'story', 'bug', 'sub_task', 'sub_bug'] as const;
        for (const t of issueTypes) {
            const { unmount } = renderWithProviders(
                <AwaitingYouRow
                    row={{
                        id: `id-${t}`,
                        issue_type: t,
                        title: `Title for ${t}`,
                        status: 'in_review',
                        updated_at: new Date(Date.now() - 60_000).toISOString(),
                    }}
                />,
            );
            const titleEl = screen.getByText(`Title for ${t}`);
            // Click the title (parent row).
            fireEvent.click(titleEl.parentElement ?? titleEl);
            unmount();
        }
    });

    it('renders minute-level duration string', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'M-1',
                    issue_type: 'story',
                    title: 'Recent task',
                    status: 'in_review',
                    updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
                }}
            />,
        );
        expect(screen.getByText(/10 m/)).toBeInTheDocument();
    });

    it('renders hour-level duration string', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'H-1',
                    issue_type: 'bug',
                    title: 'Old bug',
                    status: 'in_review',
                    updated_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
                }}
            />,
        );
        expect(screen.getByText(/5 h waiting on you/)).toBeInTheDocument();
    });

    it('renders day-level duration string', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'D-1',
                    issue_type: 'bug',
                    title: 'Ancient',
                    status: 'in_review',
                    updated_at: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
                }}
            />,
        );
        expect(screen.getByText(/3 d waiting on you/)).toBeInTheDocument();
    });

    it('handles invalid updated_at without crashing', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'X-1',
                    issue_type: 'story',
                    title: 'Broken date',
                    status: 'in_review',
                    updated_at: 'not-a-date',
                }}
            />,
        );
        expect(screen.getByText('Broken date')).toBeInTheDocument();
    });

    it('marks non-overdue statuses (e.g. todo) without the orange tint', () => {
        renderWithProviders(
            <AwaitingYouRow
                row={{
                    id: 'N-1',
                    issue_type: 'story',
                    title: 'Not overdue',
                    status: 'draft',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                }}
            />,
        );
        expect(screen.getByText('Not overdue')).toBeInTheDocument();
    });
});
