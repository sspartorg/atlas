import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeSubTask } from '../../test-utils/factories.js';
import { ReorderSubTasksDialog } from './ReorderSubTasksDialog.js';

const BASE = 'http://localhost:3000/api';

describe('ReorderSubTasksDialog', () => {
    it('moves a sub-task and saves the whole order', async () => {
        const user = userEvent.setup();
        let sent: unknown = null;
        server.use(
            http.put(`${BASE}/tasks/ATL-1/sub-tasks/order`, async ({ request }) => {
                sent = await request.json();
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <ReorderSubTasksDialog
                taskId="ATL-1"
                subTasks={[makeSubTask({ id: 'ATL-2', title: 'First' }), makeSubTask({ id: 'ATL-3', title: 'Second' })]}
                onClose={onClose}
            />,
        );
        expect(screen.getByRole('button', { name: 'Move ATL-2 up' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Move ATL-3 up' }));
        await user.click(screen.getByRole('button', { name: 'Save order' }));
        await waitFor(() => expect(sent).toEqual({ ids: ['ATL-3', 'ATL-2'] }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
