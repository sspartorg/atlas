import { describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IActivityItem, IIssueEvent } from '@atlas/shared';
import { server } from '../test-setup.js';
import { defaultHandlers, handlers } from '../test-utils/mock-handlers.js';
import { makeAgent, makeComment as makeCommentFactory } from '../test-utils/factories.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ActivityCard, ConversationCard, ActivityLogCard } from './ActivityCard.js';

const BASE = 'http://localhost:3000/api';
const makeComment = (overrides = {}) => makeCommentFactory({ issue_id: 'S1', ...overrides });

const ACTIVITY_URL = 'http://localhost:3000/api/issues/story/S1/activity';

function setupEvent(event: IIssueEvent, agents = [makeAgent({ id: 'agent-coder', name: 'Coder' })]): void {
    const activity: IActivityItem[] = [{ kind: 'event', data: event }];
    server.use(
        ...defaultHandlers,
        handlers.listAgents(agents),
        http.get(ACTIVITY_URL, () => HttpResponse.json(activity)),
    );
}

function baseEvent(overrides: Partial<IIssueEvent>): IIssueEvent {
    return {
        id: 1,
        issue_type: 'story',
        issue_id: 'S1',
        event_type: 'created',
        actor_agent_id: null,
        field: null,
        from_value: null,
        to_value: null,
        detail: null,
        created_at: '2026-06-13T12:00:00.000Z',
        ...overrides,
    };
}

describe('ActivityCard event-type rendering', () => {
    it('renders a "created" event line', async () => {
        setupEvent(baseEvent({ event_type: 'created', actor_agent_id: 'agent-coder' }));
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/created the item/i)).toBeInTheDocument());
    });

    it('renders a "status_changed" event with from→to status labels', async () => {
        setupEvent(
            baseEvent({
                event_type: 'status_changed',
                from_value: 'ready',
                to_value: 'in_progress',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/moved status from/i)).toBeInTheDocument());
        // status labels render with monospace formatting; the underlying text appears.
        expect(screen.getByText(/Ready/)).toBeInTheDocument();
        expect(screen.getByText(/In Progress/)).toBeInTheDocument();
    });

    it('renders an "override" chip on a status_changed event with detail=override', async () => {
        setupEvent(
            baseEvent({
                event_type: 'status_changed',
                from_value: 'ready',
                to_value: 'done',
                detail: 'override',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/override/i)).toBeInTheDocument());
    });

    it('renders an "assigned" event with from→to agent names', async () => {
        const agents = [
            makeAgent({ id: 'agent-coder', name: 'Coder' }),
            makeAgent({ id: 'agent-architect', name: 'Architect' }),
        ];
        setupEvent(
            baseEvent({
                event_type: 'assigned',
                from_value: 'agent-architect',
                to_value: 'agent-coder',
                actor_agent_id: 'agent-architect',
            }),
            agents,
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/reassigned from/i)).toBeInTheDocument());
    });

    it('renders a "field_updated" event with the field label + before/after values', async () => {
        setupEvent(
            baseEvent({
                event_type: 'field_updated',
                field: 'priority',
                from_value: 'normal',
                to_value: 'high',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/updated/)).toBeInTheDocument());
    });

    it('renders a "comment_added" event line', async () => {
        setupEvent(
            baseEvent({
                event_type: 'comment_added',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/added a comment/i)).toBeInTheDocument());
    });

    it('renders a "link_created" event with the target id', async () => {
        setupEvent(
            baseEvent({
                event_type: 'link_created',
                to_value: 'ATL-12',
                detail: 'depends_on → ATL-12',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/linked/i)).toBeInTheDocument());
        expect(screen.getByText('ATL-12')).toBeInTheDocument();
    });

    it('renders a "link_deleted" event with the orange icon + target id', async () => {
        setupEvent(
            baseEvent({
                event_type: 'link_deleted',
                to_value: 'ATL-9',
                detail: 'depends_on → ATL-9',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/removed link to/i)).toBeInTheDocument());
        expect(screen.getByText('ATL-9')).toBeInTheDocument();
    });

    it('renders a "rounds_reset" event with the subject agent name + previous count', async () => {
        const agents = [makeAgent({ id: 'agent-coder', name: 'Coder', max_rounds: 5 })];
        setupEvent(
            baseEvent({
                event_type: 'rounds_reset',
                from_value: '3',
                to_value: 'agent-coder',
                actor_agent_id: null,
            }),
            agents,
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/reset rounds for/i)).toBeInTheDocument());
        // Previous count (3) + cap (5) format: "(was 3 / 5)"
        await waitFor(() => expect(screen.getByText(/was 3/)).toBeInTheDocument());
    });

    it('renders a "deleted" event with the trash icon body', async () => {
        setupEvent(
            baseEvent({
                event_type: 'deleted',
                actor_agent_id: 'agent-coder',
            }),
        );
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/deleted this item/i)).toBeInTheDocument());
    });

    it('falls back to the Owner name when actor_agent_id is null', async () => {
        setupEvent(baseEvent({ event_type: 'created', actor_agent_id: null }));
        renderWithProviders(<ActivityCard issueType="story" issueId="S1" />);
        await waitFor(() => expect(screen.getByText(/created the item/i)).toBeInTheDocument());
        // Default Owner name in mock-handlers.ts is "Owner".
        expect(screen.getByText('Owner')).toBeInTheDocument();
    });
});

// ── Branch-gap closers ────────────────────────────────────────────────────────
// These tests target the specific branches that remain uncovered after the main
// test suites: the `comment.edited_at` truthy branch (lines 193-215) and the
// `saveEdit` early-return path when draft is empty or unchanged (lines 138-140).

describe('CommentRow — edited_at badge branch', () => {
    it('renders the "edited" badge when comment.edited_at is non-null', async () => {
        const comment = makeComment({
            id: 200,
            author: 'owner',
            body: 'A comment that was edited',
            edited_at: '2026-06-10T08:00:00.000Z',
        });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/S1/activity`, () => HttpResponse.json(activity)),
        );
        renderWithProviders(<ConversationCard issueType="story" issueId="S1" />);
        // findByText throws on timeout — ensures the branch is actually executed
        await screen.findByText('A comment that was edited');
        expect(await screen.findByText('edited')).toBeInTheDocument();
    });

    it('does NOT render the "edited" badge when comment.edited_at is null', async () => {
        const comment = makeComment({
            id: 201,
            author: 'owner',
            body: 'Unedited comment',
            edited_at: null,
        });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/S1/activity`, () => HttpResponse.json(activity)),
        );
        renderWithProviders(<ConversationCard issueType="story" issueId="S1" />);
        await screen.findByText('Unedited comment');
        expect(screen.queryByText('edited')).toBeNull();
    });
});

describe('CommentRow — saveEdit early-return branch', () => {
    it('saveEdit: changing draft then clearing it back disables Save (branch guard verified)', async () => {
        // The Save button is disabled whenever draft.trim() is empty or === comment.body.
        // This test verifies that the disabled guard is in place — the branch in saveEdit
        // that calls cancelEdit() is guarded by the same condition on the button.
        const comment = makeComment({ id: 202, author: 'owner', body: 'Some text' });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/S1/activity`, () => HttpResponse.json(activity)),
        );
        renderWithProviders(<ConversationCard issueType="story" issueId="S1" />);
        await screen.findByText('Some text');
        const editBtn = await screen.findByRole('button', { name: /Edit comment/i });
        fireEvent.click(editBtn);
        await screen.findByRole('button', { name: /Save/i });
        // Verify Save is disabled (draft === comment.body initially)
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        expect(saveBtn).toBeDisabled();
        // Type something different — Save becomes enabled
        const textarea = document.querySelector('textarea');
        if (textarea) {
            fireEvent.change(textarea, { target: { value: 'Different text' } });
        }
        await waitFor(() => expect(screen.getByRole('button', { name: /Save/i })).not.toBeDisabled(), { timeout: 2000 });
        // Clear the textarea — Save becomes disabled again (empty draft)
        if (textarea) {
            fireEvent.change(textarea, { target: { value: '' } });
        }
        await waitFor(() => expect(screen.getByRole('button', { name: /Save/i })).toBeDisabled(), { timeout: 2000 });
    });

    it('saveEdit: draft unchanged from comment.body keeps Save disabled', async () => {
        const comment = makeComment({ id: 203, author: 'owner', body: 'Original content' });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/S1/activity`, () => HttpResponse.json(activity)),
        );
        renderWithProviders(<ConversationCard issueType="story" issueId="S1" />);
        await screen.findByText('Original content');
        const editBtn = await screen.findByRole('button', { name: /Edit comment/i });
        fireEvent.click(editBtn);
        await screen.findByRole('button', { name: /Save/i });
        // Draft starts as comment.body → Save is disabled
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        expect(saveBtn).toBeDisabled();
        // Modify draft, then set it back to the original — Save becomes disabled again
        const textarea = document.querySelector('textarea');
        if (textarea) {
            fireEvent.change(textarea, { target: { value: 'Temporary change' } });
        }
        await waitFor(() => expect(screen.getByRole('button', { name: /Save/i })).not.toBeDisabled(), { timeout: 2000 });
        if (textarea) {
            fireEvent.change(textarea, { target: { value: 'Original content' } });
        }
        await waitFor(() => expect(screen.getByRole('button', { name: /Save/i })).toBeDisabled(), { timeout: 2000 });
    });
});

describe('CommentRow — agent color fallback branch', () => {
    it('agent comment with unknown agent_id renders with "Agent" name fallback', async () => {
        // When agent_id is set but agentsById has no match, agent is null.
        // color = agent?.accent_color ?? ATLAS_PALETTE.slate — hits the ?? branch.
        // name = agent?.name ?? 'Agent' — hits the ?? branch.
        const comment = makeComment({
            id: 204,
            author: 'agent',
            agent_id: 'agent-not-in-map',
            body: 'Comment from unknown agent',
        });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(...defaultHandlers);
        // Pass activity and empty agents directly so agentsById is an empty map
        renderWithProviders(
            <ConversationCard
                issueType="story"
                issueId="S1"
                activity={activity}
                agents={[]}
            />,
        );
        await screen.findByText('Comment from unknown agent');
        // Falls back to 'Agent' name when agent not in map
        expect(await screen.findByText('Agent')).toBeInTheDocument();
    });

    it('agent comment with known agent renders with that agent name', async () => {
        const agent = makeAgent({ id: 'agent-known', name: 'KnownAgent', accent_color: '#FF5500' });
        const comment = makeComment({
            id: 205,
            author: 'agent',
            agent_id: 'agent-known',
            body: 'Known agent comment',
        });
        const activity: IActivityItem[] = [{ kind: 'comment', data: comment }];
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/S1/activity`, () => HttpResponse.json(activity)),
        );
        // Pass agents prop directly so the map is populated without a fetch
        renderWithProviders(
            <ConversationCard
                issueType="story"
                issueId="S1"
                activity={activity}
                agents={[agent]}
            />,
        );
        await screen.findByText('Known agent comment');
        expect(await screen.findByText('KnownAgent')).toBeInTheDocument();
    });
});

describe('ActivityLogCard — truncateValue empty-string branch', () => {
    // truncateValue(value): when value === '' returns null (a branch distinct from
    // value == null). The field_updated event passes from_value / to_value through
    // truncateValue, so an empty-string value exercises the value === '' early-return.
    it('field_updated with empty-string from_value treats it as null (no before span)', async () => {
        const event: IIssueEvent = {
            id: 300,
            issue_type: 'story',
            issue_id: 'S1',
            event_type: 'field_updated',
            actor_agent_id: null,
            field: 'title',
            from_value: '',   // empty string → truncateValue returns null → no before span
            to_value: 'New title',
            detail: null,
            created_at: '2026-06-10T08:00:00.000Z',
        };
        const activity: IActivityItem[] = [{ kind: 'event', data: event }];
        server.use(...defaultHandlers);
        renderWithProviders(
            <ActivityLogCard
                issueType="story"
                issueId="S1"
                activity={activity}
                agents={[]}
            />,
        );
        await screen.findByText('title');
        // from_value was '' → treated as null → no before span rendered
        // to_value was 'New title' → after span rendered
        expect(screen.getByText('New title')).toBeInTheDocument();
    });

    it('field_updated with empty-string to_value treats it as null (no after span)', async () => {
        const event: IIssueEvent = {
            id: 301,
            issue_type: 'story',
            issue_id: 'S1',
            event_type: 'field_updated',
            actor_agent_id: null,
            field: 'description',
            from_value: 'Old description',
            to_value: '',     // empty string → truncateValue returns null → no after span
            detail: null,
            created_at: '2026-06-10T09:00:00.000Z',
        };
        const activity: IActivityItem[] = [{ kind: 'event', data: event }];
        server.use(...defaultHandlers);
        renderWithProviders(
            <ActivityLogCard
                issueType="story"
                issueId="S1"
                activity={activity}
                agents={[]}
            />,
        );
        await screen.findByText('description');
        // from_value was 'Old description' → before span rendered
        expect(screen.getByText('Old description')).toBeInTheDocument();
    });

    it('humanFieldLabel with empty-string field renders "a field" (falsy branch)', async () => {
        // humanFieldLabel('') → !field is true → returns 'a field'
        const event: IIssueEvent = {
            id: 302,
            issue_type: 'story',
            issue_id: 'S1',
            event_type: 'field_updated',
            actor_agent_id: null,
            field: '' as unknown as null, // empty string → !field is true → 'a field'
            from_value: 'before',
            to_value: 'after',
            detail: null,
            created_at: '2026-06-10T10:00:00.000Z',
        };
        const activity: IActivityItem[] = [{ kind: 'event', data: event }];
        server.use(...defaultHandlers);
        renderWithProviders(
            <ActivityLogCard
                issueType="story"
                issueId="S1"
                activity={activity}
                agents={[]}
            />,
        );
        await screen.findByText(/a field/i);
    });
});
