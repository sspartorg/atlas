import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { Toast } from '../../components/Toast.js';
import { JiraStatusMapCard, mappingProblems } from './JiraStatusMapCard.js';

const BASE = 'http://localhost:3000/api';

function mount(project = makeProject()) {
    let body: Record<string, unknown> | null = null;
    server.use(
        http.patch(`${BASE}/projects/${project.id}`, async ({ request }) => {
            body = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json({ ...project, ...body });
        })
    );
    renderWithProviders(
        <>
            <JiraStatusMapCard project={project} />
            <Toast />
        </>
    );
    return () => body;
}

describe('JiraStatusMapCard', () => {
    it('explains that an unset mapping ignores Jira status', () => {
        mount();
        expect(screen.getByText(/Not set: Jira's status is ignored/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    });

    it("doesn't tell the Owner to leave fields empty when Ready is required", () => {
        mount();
        expect(screen.queryByText(/Leave it empty/)).toBeNull();
        expect(screen.getByText(/A mapping needs at least one\s+Ready status/)).toBeInTheDocument();
    });

    it('requires Ready, refuses a Jira status in two groups, then saves trimmed lists', async () => {
        const sent = mount();
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('Jira statuses for In Progress'), 'Dev, QA');
        await user.click(screen.getByRole('button', { name: 'Save mapping' }));
        expect(screen.queryByText(/Jira status to Draft/)).not.toBeInTheDocument();
        expect(screen.getByText('Map at least one Jira status to Ready')).toBeInTheDocument();
        expect(sent()).toBeNull();

        await user.type(screen.getByLabelText('Jira statuses for Draft'), ' Backlog , ');
        await user.type(screen.getByLabelText('Jira statuses for Ready'), 'Selected, qa');
        await user.click(screen.getByRole('button', { name: 'Save mapping' }));
        expect(screen.getByText(/"QA" is already mapped to Ready/)).toBeInTheDocument();

        await user.clear(screen.getByLabelText('Jira statuses for Ready'));
        await user.type(screen.getByLabelText('Jira statuses for Ready'), 'Selected for Development');
        await user.click(screen.getByRole('button', { name: 'Save mapping' }));
        await waitFor(() => expect(sent()).not.toBeNull());
        expect(sent()).toEqual({
            jira_status_map: {
                draft: ['Backlog'],
                ready: ['Selected for Development'],
                in_progress: ['Dev', 'QA'],
                waiting_for_info: [],
                in_review: [],
                done: [],
            },
        });
        expect(await screen.findByText('Status mapping saved')).toBeInTheDocument();
    });

    it('shows a saved mapping and can clear it', async () => {
        const project = makeProject({
            jira_status_map: { draft: ['Backlog'], ready: ['Selected'], in_progress: ['Dev'], waiting_for_info: [], in_review: [], done: ['Done'] },
        });
        const sent = mount(project);
        expect(screen.getByLabelText('Jira statuses for Ready')).toHaveValue('Selected');
        await userEvent.click(screen.getByRole('button', { name: 'Clear mapping' }));
        await waitFor(() => expect(sent()).toEqual({ jira_status_map: null }));
        expect(await screen.findByText('Status mapping cleared')).toBeInTheDocument();
    });

    it('mappingProblems is case-insensitive about duplicates', () => {
        const v = { draft: 'Backlog', ready: 'backlog', in_progress: '', waiting_for_info: '', in_review: '', done: '' };
        expect(mappingProblems(v).ready).toMatch(/already mapped to Draft/);
    });
});
