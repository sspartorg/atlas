import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IIssueLinkRow } from '@atlas/shared';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeSubTask, makeTaskListItem } from '../test-utils/factories.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { LinkPickerDialog } from './LinkPickerDialog.js';

const BASE = 'http://localhost:3000/api';

type Mode = 'relates_to' | 'depends_on' | 'tested_by';

function renderPicker(
    mode: Mode,
    opts: { onClose?: () => void; links?: IIssueLinkRow[]; restrictToTaskId?: string } = {}
) {
    const onClose = opts.onClose ?? vi.fn();
    renderWithProviders(
        <LinkPickerDialog
            open
            mode={mode}
            fromIssueType="sub_task"
            fromIssueId="ST-0"
            links={opts.links ?? []}
            restrictToTaskId={opts.restrictToTaskId}
            onClose={onClose}
        />
    );
    return onClose;
}

async function search(text: string) {
    await userEvent.type(screen.getByRole('textbox'), text);
}

describe('LinkPickerDialog', () => {
    it('renders the tested_by title and same-task reminder', async () => {
        renderPicker('tested_by', { restrictToTaskId: 'T1' });
        await screen.findByText('Add test link');
        expect(
            screen.getByText(
                'This item will be the test holder. Pick the item it tests (same task only).'
            )
        ).toBeInTheDocument();
    });

    it('renders the relates_to title', async () => {
        renderPicker('relates_to');
        expect(await screen.findByText('Link an item')).toBeInTheDocument();
        expect(screen.queryByText('Add test link')).not.toBeInTheDocument();
    });

    it('renders the depends_on title', async () => {
        renderPicker('depends_on');
        expect(await screen.findByText('Add dependency')).toBeInTheDocument();
    });

    it('shows the typing hint on an empty query and "No matches." for a miss', async () => {
        renderPicker('relates_to');
        expect(await screen.findByText(/Start typing to search/i)).toBeInTheDocument();
        await search('zzznomatch999');
        expect(await screen.findByText('No matches.')).toBeInTheDocument();
    });

    it('links a task in relates_to mode and closes', async () => {
        let body: unknown = null;
        server.use(
            handlers.listTasks([makeTaskListItem({ id: 'ATL-50', title: 'Target Task' })]),
            http.post(`${BASE}/issues/sub_task/ST-0/links`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ id: 1 });
            })
        );
        const onClose = renderPicker('relates_to');
        await search('Target');
        fireEvent.click(await screen.findByText('Target Task'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toMatchObject({
            to_type: 'task',
            to_id: 'ATL-50',
            relation_type: 'relates_to',
        });
    });

    it('links a sub-task in depends_on mode and closes', async () => {
        server.use(
            handlers.listSubTasks([makeSubTask({ id: 'ST-51', title: 'Blocking Sub-task' })]),
            http.post(`${BASE}/issues/sub_task/ST-0/links`, () => HttpResponse.json({ id: 2 }))
        );
        const onClose = renderPicker('depends_on');
        await search('Blocking');
        fireEvent.click(await screen.findByText('Blocking Sub-task'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows the error when the link create fails and stays open', async () => {
        server.use(
            handlers.listTasks([makeTaskListItem({ id: 'ATL-52', title: 'Error Task' })]),
            http.post(`${BASE}/issues/sub_task/ST-0/links`, () =>
                HttpResponse.json({ error: 'Duplicate link' }, { status: 422 })
            )
        );
        const onClose = renderPicker('relates_to');
        await search('Error');
        fireEvent.click(await screen.findByText('Error Task'));
        expect(await screen.findByText(/Duplicate link/)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('tested_by offers only sub-tasks of the restricted task', async () => {
        server.use(
            handlers.listTasks([makeTaskListItem({ id: 'T1', title: 'Twin parent' })]),
            handlers.listSubTasks([
                makeSubTask({ id: 'ST-1', task_id: 'T1', title: 'Twin in task' }),
                makeSubTask({ id: 'ST-2', task_id: 'T2', title: 'Twin elsewhere' }),
            ])
        );
        renderPicker('tested_by', { restrictToTaskId: 'T1' });
        await search('Twin');
        expect(await screen.findByText('Twin in task')).toBeInTheDocument();
        expect(screen.queryByText('Twin elsewhere')).not.toBeInTheDocument();
        expect(screen.queryByText('Twin parent')).not.toBeInTheDocument();
    });

    it('excludes the source item and items already linked at this relation', async () => {
        const preLinked: IIssueLinkRow[] = [
            {
                id: 1,
                type: 'task',
                item_id: 'ATL-50',
                short_id: 'ATL-50',
                title: 'Already Linked',
                status: 'draft',
                relation_type: 'relates_to',
                direction: 'outgoing',
                created_at: '2026-05-01T00:00:00.000Z',
            } as IIssueLinkRow,
        ];
        server.use(
            handlers.listTasks([makeTaskListItem({ id: 'ATL-50', title: 'Already Linked' })]),
            handlers.listSubTasks([
                makeSubTask({ id: 'ST-0', title: 'Already Self' }),
                makeSubTask({ id: 'ST-9', title: 'Already Free' }),
            ])
        );
        renderPicker('relates_to', { links: preLinked });
        await search('Already');
        expect(await screen.findByText('Already Free')).toBeInTheDocument();
        expect(screen.queryByText('Already Linked')).not.toBeInTheDocument();
        expect(screen.queryByText('Already Self')).not.toBeInTheDocument();
    });

    it('footer Cancel fires onClose', async () => {
        const onClose = renderPicker('relates_to');
        await screen.findByText('Link an item');
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
        expect(onClose).toHaveBeenCalled();
    });
});
