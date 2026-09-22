import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import type * as RouterModule from 'react-router-dom';
import { NewProjectModal } from './NewProjectModal.js';

const BASE = 'http://localhost:3000/api';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof RouterModule>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

function mount(onClose = vi.fn()) {
    renderWithProviders(<NewProjectModal open onClose={onClose} />);
    return { onClose };
}

beforeEach(() => {
    navigate.mockClear();
    server.use(
        http.get(`${BASE}/projects/prefix-available`, () =>
            HttpResponse.json({ available: true })
        )
    );
});

describe('NewProjectModal', () => {
    // ADR 0018 made a project a container of equal repos; creation still asked
    // for one repo URL, a credential and a branch. A project is a wrapper now.
    it('asks for a name, key and description — and nothing about repos', async () => {
        mount();
        expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Issue key prefix/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Description/)).toBeInTheDocument();

        expect(screen.queryByLabelText(/Repository URL/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/credential/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Default branch/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Use existing folder/i)).not.toBeInTheDocument();
    });

    it('derives the key from the name until it is typed over', async () => {
        mount();
        await userEvent.type(screen.getByLabelText(/^Name/), 'Atlas Web');
        expect(screen.getByLabelText(/Issue key prefix/)).toHaveValue('ATL');

        await userEvent.clear(screen.getByLabelText(/Issue key prefix/));
        await userEvent.type(screen.getByLabelText(/Issue key prefix/), 'XYZ');
        await userEvent.type(screen.getByLabelText(/^Name/), ' Two');
        expect(screen.getByLabelText(/Issue key prefix/)).toHaveValue('XYZ');
    });

    it('creates the project and lands on its Repos tab', async () => {
        let body: unknown;
        server.use(
            http.post(`${BASE}/projects`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ id: 'p9', name: 'Atlas Web' }, { status: 201 });
            })
        );
        const { onClose } = mount();

        await userEvent.type(screen.getByLabelText(/^Name/), 'Atlas Web');
        await screen.findByText(/Available\./);
        await userEvent.click(screen.getByRole('button', { name: /Create project/i }));

        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects/p9?tab=repos'));
        expect(body).toEqual({ name: 'Atlas Web', issue_key_prefix: 'ATL' });
        expect(onClose).toHaveBeenCalled();
    });

    it('refuses a prefix another project already holds', async () => {
        server.use(
            http.get(`${BASE}/projects/prefix-available`, () =>
                HttpResponse.json({ available: false, reason: 'in_use', conflict: 'Atlas API' })
            )
        );
        mount();
        await userEvent.type(screen.getByLabelText(/^Name/), 'Atlas Web');

        expect(await screen.findByText(/Already used by "Atlas API"/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create project/i })).toBeDisabled();
    });

    it('surfaces a server error instead of navigating', async () => {
        server.use(
            http.post(`${BASE}/projects`, () =>
                HttpResponse.json({ error: 'Workspace path is not set' }, { status: 400 })
            )
        );
        mount();
        await userEvent.type(screen.getByLabelText(/^Name/), 'Atlas Web');
        await screen.findByText(/Available\./);
        await userEvent.click(screen.getByRole('button', { name: /Create project/i }));

        expect(await screen.findByText(/Workspace path is not set/)).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });
});
