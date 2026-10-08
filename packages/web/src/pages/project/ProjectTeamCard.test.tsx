import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IProject, TeamConfigRole } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { makeProject } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { TeamManagedAlert } from '../../components/TeamManagedAlert.js';
import { ProjectTeamCard } from './ProjectTeamCard.js';

const apiBase = 'http://localhost:3000/api';

function serve(role: TeamConfigRole, onPatch: (body: unknown) => void = () => undefined) {
    server.use(
        http.get(`${apiBase}/team-config`, () =>
            HttpResponse.json({ role, repo_url: 'https://github.com/acme/team.git', credential_id: 'c1', branch: 'main', interval_minutes: 60 })
        ),
        http.patch(`${apiBase}/projects/:id`, async ({ request }) => {
            const body = (await request.json()) as Partial<IProject>;
            onPatch(body);
            return HttpResponse.json(makeProject({ ...body }));
        })
    );
}

function mount(project: IProject) {
    renderWithProviders(
        <>
            <ProjectTeamCard project={project} />
            <Toast />
        </>
    );
}

describe('ProjectTeamCard', () => {
    it('renders nothing while team config is off', async () => {
        serve('off');
        mount(makeProject({ team_managed: true }));
        await waitFor(() => expect(screen.queryByText(/team config/i)).not.toBeInTheDocument());
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('lets a publisher include the project', async () => {
        const patches: unknown[] = [];
        serve('publisher', (b) => patches.push(b));
        mount(makeProject({ team_managed: false }));
        const toggle = await screen.findByRole('switch', { name: /Include in team config/ });
        expect(toggle).not.toBeChecked();
        await userEvent.click(toggle);
        await waitFor(() => expect(patches).toEqual([{ team_managed: true }]));
        expect(await screen.findByText('Included in team config')).toBeInTheDocument();
    });

    it('lets a publisher take the project out again', async () => {
        const patches: unknown[] = [];
        serve('publisher', (b) => patches.push(b));
        mount(makeProject({ team_managed: true }));
        const toggle = await screen.findByRole('switch', { name: /Include in team config/ });
        expect(toggle).toBeChecked();
        await userEvent.click(toggle);
        await waitFor(() => expect(patches).toEqual([{ team_managed: false }]));
        expect(await screen.findByText('Removed from team config')).toBeInTheDocument();
    });

    it('never offers a publisher the overwrite warning', async () => {
        serve('publisher');
        mount(makeProject({ team_managed: true }));
        await screen.findByRole('switch');
        expect(screen.queryByText(/overwritten on the next sync/)).not.toBeInTheDocument();
    });

    it('warns a subscriber that local edits to a team project are overwritten', async () => {
        serve('subscriber');
        mount(makeProject({ team_managed: true }));
        expect(await screen.findByText(/This project is managed by my team config/)).toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it("doesn't warn a subscriber about their own project", async () => {
        serve('subscriber');
        mount(makeProject({ team_managed: false }));
        await waitFor(() => expect(screen.queryByText(/managed by my team config/)).not.toBeInTheDocument());
    });
});

describe('TeamManagedAlert', () => {
    it('names what it sits on', async () => {
        serve('subscriber');
        renderWithProviders(<TeamManagedAlert managed noun="workflow" />);
        expect(await screen.findByText(/This workflow is managed by my team config/)).toBeInTheDocument();
    });

    it.each([
        ['publisher', true],
        ['off', true],
        ['subscriber', false],
    ] as const)('stays hidden for role %s with managed=%s', async (role, managed) => {
        serve(role);
        renderWithProviders(<TeamManagedAlert managed={managed} noun="agent" />);
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByText(/managed by my team config/)).not.toBeInTheDocument();
    });
});
