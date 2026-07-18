import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IEnvVar } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { HelpAboutTab } from './HelpAboutTab.js';

const apiBase = 'http://localhost:3000/api';
const DEFAULT_URL = 'https://github.com/sspartorg/atlas/issues';

function feedbackVar(value: string): IEnvVar {
    return {
        key: 'ATLAS_FEEDBACK_URL',
        value,
        description: 'feedback URL',
        restart_required: false,
        secret: false,
    };
}

function mountEnv(vars: IEnvVar[]): void {
    server.use(http.get(`${apiBase}/settings/env`, () => HttpResponse.json({ vars })));
}

describe('HelpAboutTab', () => {
    it('renders app name, version, and repo link after data loads', async () => {
        mountEnv([feedbackVar(DEFAULT_URL)]);
        renderWithProviders(<HelpAboutTab />);
        await waitFor(() => expect(screen.getByText(/About Atlas/i)).toBeInTheDocument());
        // `v1.0` appears in the UI (release tag pill + release-notes sub-text).
        // Use getAllByText and assert on the count instead of getByText which
        // throws on multiple matches.
        expect(screen.getAllByText(/v1\.0/).length).toBeGreaterThan(0);
        expect(screen.getByRole('link', { name: /github\.com\/sspartorg\/atlas/i })).toBeInTheDocument();
    });

    it('shows the current feedback URL from useEnv', async () => {
        mountEnv([feedbackVar(DEFAULT_URL)]);
        renderWithProviders(<HelpAboutTab />);
        await waitFor(() => {
            expect(screen.getByText(DEFAULT_URL)).toBeInTheDocument();
        });
    });

    it('renders a placeholder + fallback URL when ATLAS_FEEDBACK_URL is blank', async () => {
        mountEnv([feedbackVar('')]);
        renderWithProviders(<HelpAboutTab />);
        await waitFor(() =>
            expect(screen.getByText(/unset — falls back to/)).toBeInTheDocument(),
        );
    });

    it('Open GitHub Issues button has target=_blank and points at the effective URL', async () => {
        mountEnv([feedbackVar(DEFAULT_URL)]);
        renderWithProviders(<HelpAboutTab />);
        const btn = await screen.findByRole('link', { name: /Open GitHub Issues/i });
        expect(btn.getAttribute('href')).toBe(DEFAULT_URL);
        expect(btn.getAttribute('target')).toBe('_blank');
    });

    it('renders the mailto label + no target=_blank when feedback URL is a mailto', async () => {
        mountEnv([feedbackVar('mailto:you@example.com')]);
        renderWithProviders(<HelpAboutTab />);
        const btn = await screen.findByRole('link', { name: /Email a bug report/i });
        expect(btn.getAttribute('href')).toBe('mailto:you@example.com');
        expect(btn.getAttribute('target')).toBeNull();
    });

    it('hides the Restore button when the URL already equals the recommended default', async () => {
        mountEnv([feedbackVar(DEFAULT_URL)]);
        renderWithProviders(<HelpAboutTab />);
        await screen.findByRole('link', { name: /Open GitHub Issues/i });
        expect(screen.queryByRole('button', { name: /Restore recommended URL/i })).toBeNull();
    });

    it('Restore recommended URL PATCHes with the default URL', async () => {
        let captured: { updates: Array<{ key: string; value: string }> } | null = null;
        mountEnv([feedbackVar('')]);
        server.use(
            http.patch(`${apiBase}/settings/env`, async ({ request }) => {
                captured = (await request.json()) as typeof captured;
                return HttpResponse.json({ vars: [feedbackVar(DEFAULT_URL)] });
            }),
        );
        renderWithProviders(<HelpAboutTab />);
        const restore = await screen.findByRole('button', { name: /Restore recommended URL/i });
        await userEvent.click(restore);
        await waitFor(() => expect(captured).not.toBeNull());
        expect(captured!.updates).toEqual([
            { key: 'ATLAS_FEEDBACK_URL', value: DEFAULT_URL },
        ]);
    });
});
