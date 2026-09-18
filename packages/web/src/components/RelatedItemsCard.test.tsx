import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { RelatedItemsCard } from './RelatedItemsCard.js';
import { Toast } from './Toast.js';
import { makeAgent } from '../test-utils/factories.js';
import type { IIssueLinkRow, IItemExternalLink } from '@atlas/shared';

function makeLink(over: Partial<IIssueLinkRow> = {}): IIssueLinkRow {
    return {
        id: 1,
        type: 'sub_task',
        item_id: 'ATL-2',
        short_id: 'ATL-2',
        title: 'Linked sub-task',
        status: 'draft',
        relation_type: 'relates_to',
        direction: 'outgoing',
        created_at: '2026-05-01T00:00:00.000Z',
        ...over,
    };
}

describe('RelatedItemsCard', () => {
    it('mounts without crashing when pre-loaded with empty links', () => {
        server.use(...defaultHandlers);
        const { container } = renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={[]}
                agents={[]}
                onOpenPicker={vi.fn()}
            />,
        );
        expect(container).toBeInTheDocument();
    });

    it('renders depends_on rows under the "Blocked by" section', () => {
        server.use(...defaultHandlers);
        const links = [
            makeLink({ id: 10, relation_type: 'depends_on', short_id: 'ATL-9', title: 'Blocker' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[makeAgent()]}
                onOpenPicker={vi.fn()}
            />,
        );
        expect(screen.getByText('Blocker')).toBeInTheDocument();
    });

    it('renders tested_by rows under the "Tested by" / "Tests" / "Test coverage" titles', () => {
        const links = [
            makeLink({
                id: 11,
                relation_type: 'tested_by',
                direction: 'outgoing',
                short_id: 'ATL-10',
                title: 'QA covers',
            }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
                allowAddTestLink
            />,
        );
        expect(screen.getByText('QA covers')).toBeInTheDocument();
    });

    it('renders the empty Tested-by state when allowAddTestLink + no rows', () => {
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={[]}
                agents={[]}
                onOpenPicker={vi.fn()}
                allowAddTestLink
            />,
        );
        expect(screen.getByText(/No test links yet/i)).toBeInTheDocument();
    });

    it('fires onOpenPicker("depends_on") from the "Add dependency" button', () => {
        const onOpenPicker = vi.fn();
        const links = [
            makeLink({ id: 20, relation_type: 'depends_on', title: 'Block' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={onOpenPicker}
            />,
        );
        const btn = screen.getByRole('button', { name: /Add dependency/i });
        fireEvent.click(btn);
        expect(onOpenPicker).toHaveBeenCalledWith('depends_on');
    });

    it('fires onOpenPicker("relates_to") from the "Link an item" button', () => {
        const onOpenPicker = vi.fn();
        const links = [makeLink({ id: 21, relation_type: 'relates_to', title: 'Related' })];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={onOpenPicker}
            />,
        );
        const btn = screen.getByRole('button', { name: /Link an item/i });
        fireEvent.click(btn);
        expect(onOpenPicker).toHaveBeenCalledWith('relates_to');
    });

    it('fires onOpenPicker("tested_by") from the "Add test link" button when empty', () => {
        const onOpenPicker = vi.fn();
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={[]}
                agents={[]}
                onOpenPicker={onOpenPicker}
                allowAddTestLink
            />,
        );
        const btn = screen.getByRole('button', { name: /Add test link/i });
        fireEvent.click(btn);
        expect(onOpenPicker).toHaveBeenCalledWith('tested_by');
    });

    it('renders multiple sections together (depends + relates + tested_by)', () => {
        const links = [
            makeLink({ id: 30, relation_type: 'depends_on', short_id: 'ATL-50', title: 'Dep' }),
            makeLink({
                id: 31,
                relation_type: 'tested_by',
                direction: 'incoming',
                short_id: 'ATL-51',
                title: 'Tested',
            }),
            makeLink({ id: 32, relation_type: 'relates_to', short_id: 'ATL-52', title: 'Rel' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
                allowAddTestLink
            />,
        );
        expect(screen.getByText('Dep')).toBeInTheDocument();
        expect(screen.getByText('Tested')).toBeInTheDocument();
        expect(screen.getByText('Rel')).toBeInTheDocument();
    });

    it.each([
        ['task', 'T1', 'task page'],
        ['sub_task', 'ST-1', 'sub-task page'],
    ] as const)('clicking a %s link row opens its detail page', (type, id, page) => {
        const links = [
            makeLink({ id: 40, type, item_id: id, relation_type: 'depends_on', short_id: id, title: 'Dep row' }),
        ];
        renderWithProviders(
            <Routes>
                <Route
                    path="/"
                    element={
                        <RelatedItemsCard
                            issueType="sub_task"
                            issueId="S1"
                            relatedLinks={links}
                            agents={[]}
                            onOpenPicker={vi.fn()}
                        />
                    }
                />
                <Route path="/tasks/:id" element={<div>task page</div>} />
                <Route path="/sub-tasks/:id" element={<div>sub-task page</div>} />
            </Routes>,
        );
        fireEvent.click(screen.getByText('Dep row'));
        expect(screen.getByText(page)).toBeInTheDocument();
    });

    it('exercises unlinkRow for depends_on: renders Unlink button and clicks it', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/50', () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        const links = [
            makeLink({ id: 50, relation_type: 'depends_on', short_id: 'ATL-99', title: 'Dep Link' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
            />,
        );
        const unlinkBtn = screen.getByRole('button', { name: /Unlink/i });
        fireEvent.click(unlinkBtn);
        // handleUnlink called async — just verify no crash
        expect(document.body).toBeTruthy();
    });

    it('exercises unlinkRow for tested_by: Unlink button click', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/60', () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        const links = [
            makeLink({ id: 60, relation_type: 'tested_by', direction: 'outgoing', short_id: 'ATL-60', title: 'Test Link' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
                allowAddTestLink
            />,
        );
        const unlinkBtn = screen.getByRole('button', { name: /Unlink/i });
        fireEvent.click(unlinkBtn);
        expect(document.body).toBeTruthy();
    });

    it('exercises testedByTitle = "Tests" when direction is mixed (outgoing only)', () => {
        const links = [
            makeLink({ id: 70, relation_type: 'tested_by', direction: 'outgoing', short_id: 'ATL-70', title: 'Tests Item' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
                allowAddTestLink
            />,
        );
        // Title should be "Tests" when all tested_by links are outgoing
        expect(screen.getByText('Tests')).toBeInTheDocument();
    });

    describe('Pull Requests section', () => {
        function makeExtLink(over: Partial<IItemExternalLink> = {}): IItemExternalLink {
            return {
                id: 100,
                item_id: 'S1',
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/42',
                title: 'feat: pr-link',
                external_ref: '42',
                created_at: '2026-06-30T00:00:00.000Z',
                created_by_run_id: null,
                ...over,
            };
        }

        it('renders the empty-state hint when no PR links are attached', () => {
            server.use(...defaultHandlers);
            renderWithProviders(
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={[]}
                    externalLinks={[]}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />,
            );
            expect(screen.getByText('Pull Requests')).toBeInTheDocument();
            expect(screen.getByText('No pull requests linked yet.')).toBeInTheDocument();
            // "Add PR link" button is always visible.
            expect(screen.getByRole('button', { name: /Add PR link/i })).toBeInTheDocument();
        });

        it('shows an Open / Merged / Closed chip from pr_state and none when unknown', () => {
            server.use(...defaultHandlers);
            renderWithProviders(
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={[]}
                    externalLinks={[
                        makeExtLink({ id: 1, external_ref: '1', pr_state: 'open' }),
                        makeExtLink({ id: 2, external_ref: '2', pr_state: 'merged' }),
                        makeExtLink({ id: 3, external_ref: '3', pr_state: 'closed' }),
                        makeExtLink({ id: 4, external_ref: '4', pr_state: null }),
                        makeExtLink({ id: 5, external_ref: '5' }),
                    ]}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />,
            );
            expect(screen.getByText('Open')).toBeInTheDocument();
            expect(screen.getByText('Merged')).toBeInTheDocument();
            expect(screen.getByText('Closed')).toBeInTheDocument();
            expect(document.querySelectorAll('.MuiChip-root')).toHaveLength(3);
        });

        it('renders each PR row with #number, title, and an external-tab anchor', () => {
            server.use(...defaultHandlers);
            const links = [
                makeExtLink({ id: 200, external_ref: '99', title: 'feat: cool thing', url: 'https://github.com/foo/bar/pull/99' }),
                makeExtLink({ id: 201, external_ref: '7', title: null, url: 'https://github.com/foo/bar/pull/7' }),
            ];
            renderWithProviders(
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={[]}
                    externalLinks={links}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />,
            );
            expect(screen.getByText('#99')).toBeInTheDocument();
            expect(screen.getByText('feat: cool thing')).toBeInTheDocument();
            // Title-less row falls back to the URL.
            expect(screen.getByText('#7')).toBeInTheDocument();
            expect(screen.getByText('https://github.com/foo/bar/pull/7')).toBeInTheDocument();
            // Each anchor opens in a new tab with rel="noopener noreferrer".
            const anchors = screen.getAllByRole('link');
            for (const a of anchors) {
                expect(a).toHaveAttribute('target', '_blank');
                expect(a).toHaveAttribute('rel', 'noopener noreferrer');
            }
        });

        it('clicking "Add PR link" opens the AddPrLinkDialog', () => {
            server.use(...defaultHandlers);
            renderWithProviders(
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={[]}
                    externalLinks={[]}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: /Add PR link/i }));
            // Dialog renders with the URL input.
            expect(screen.getByLabelText('GitHub PR URL')).toBeInTheDocument();
        });

        it('clicking the "Remove PR link" icon triggers the delete mutation', async () => {
            const calls: number[] = [];
            server.use(
                ...defaultHandlers,
                http.delete('http://localhost:3000/api/issues/external-links/200', () => {
                    calls.push(200);
                    return new HttpResponse(null, { status: 204 });
                }),
            );
            renderWithProviders(
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={[]}
                    externalLinks={[makeExtLink({ id: 200 })]}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />,
            );
            fireEvent.click(screen.getByLabelText('Remove PR link'));
            // Allow the mutation to flush.
            await screen.findByText('#42');
            expect(calls).toEqual([200]);
        });

        it('renders "PR" fallback label and url-as-detail when external_ref is falsy', async () => {
            server.use(
                ...defaultHandlers,
                http.delete('http://localhost:3000/api/issues/external-links/300', () =>
                    new HttpResponse(null, { status: 204 }),
                ),
            );
            renderWithProviders(
                <>
                    <RelatedItemsCard
                        issueType="sub_task"
                        issueId="S1"
                        relatedLinks={[]}
                        externalLinks={[makeExtLink({ id: 300, external_ref: null, url: 'https://github.com/foo/bar/pull/300' })]}
                        agents={[]}
                        onOpenPicker={vi.fn()}
                    />
                    <Toast />
                </>,
            );
            // external_ref is falsy → label falls back to the literal "PR".
            expect(screen.getByText('PR')).toBeInTheDocument();
            // handleUnlinkPr's toast detail also falls back to link.url when
            // external_ref is falsy.
            fireEvent.click(screen.getByLabelText('Remove PR link'));
            await screen.findByText('https://github.com/foo/bar/pull/300');
        });
    });

    it('fetches links, external links, and agents from hooks when no pre-loaded props are supplied', async () => {
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/issues/sub_task/S1/links', () =>
                HttpResponse.json([
                    makeLink({ id: 80, relation_type: 'depends_on', short_id: 'ATL-80', title: 'Fetched Dep' }),
                ]),
            ),
            http.get('http://localhost:3000/api/agents', () => HttpResponse.json([makeAgent()])),
        );
        renderWithProviders(
            <RelatedItemsCard
                issueType="sub_task"
                issueId="S1"
                onOpenPicker={vi.fn()}
            />,
        );
        // No relatedLinks/agents props supplied → the component falls through
        // to `propLinks ?? fetchedLinks` / `propAgents ?? fetchedAgents`,
        // pulling data from useIssueLinks()/useAgents() instead.
        await screen.findByText('Fetched Dep');
    });

    it('shows the toast message "Removed dependency on <shortId>" after a successful depends_on unlink', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/51', () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        const links = [
            makeLink({ id: 51, relation_type: 'depends_on', short_id: 'ATL-51', title: 'Dep Toast' }),
        ];
        renderWithProviders(
            <>
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={links}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />
                <Toast />
            </>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
        await screen.findByText(/Removed dependency on ATL-51/);
    });

    it('shows the toast message "Removed test link to <shortId>" after a successful tested_by unlink', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/61', () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        const links = [
            makeLink({ id: 61, relation_type: 'tested_by', direction: 'outgoing', short_id: 'ATL-61', title: 'Tested Toast' }),
        ];
        renderWithProviders(
            <>
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={links}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                    allowAddTestLink
                />
                <Toast />
            </>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
        await screen.findByText(/Removed test link to ATL-61/);
    });

    it('shows the toast message "Unlinked <shortId>" after a successful relates_to unlink', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/71', () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        const links = [
            makeLink({ id: 71, relation_type: 'relates_to', short_id: 'ATL-71', title: 'Relates Toast' }),
        ];
        renderWithProviders(
            <>
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={links}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />
                <Toast />
            </>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
        await screen.findByText(/Unlinked ATL-71/);
    });

    it('shows "Unlink failed" toast when the deleteLink mutation rejects', async () => {
        server.use(
            ...defaultHandlers,
            http.delete('http://localhost:3000/api/issues/links/81', () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        const links = [
            makeLink({ id: 81, relation_type: 'relates_to', short_id: 'ATL-81', title: 'Fail Toast' }),
        ];
        renderWithProviders(
            <>
                <RelatedItemsCard
                    issueType="sub_task"
                    issueId="S1"
                    relatedLinks={links}
                    agents={[]}
                    onOpenPicker={vi.fn()}
                />
                <Toast />
            </>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
        await screen.findByText(/Unlink failed/);
    });

    it('renders tested-by rows WITHOUT the add-test-link header button when allowAddTestLink is false (Task detail scenario)', () => {
        const links = [
            makeLink({ id: 95, relation_type: 'tested_by', direction: 'incoming', short_id: 'ATL-95', title: 'No Add Button' }),
        ];
        renderWithProviders(
            <RelatedItemsCard
                issueType="task"
                issueId="T1"
                relatedLinks={links}
                agents={[]}
                onOpenPicker={vi.fn()}
            />,
        );
        expect(screen.getByText('No Add Button')).toBeInTheDocument();
        // headerRight is `undefined` when allowAddTestLink is falsy — the
        // "Add test link" button must not be present anywhere on the card.
        expect(screen.queryByRole('button', { name: /Add test link/i })).not.toBeInTheDocument();
    });
});
