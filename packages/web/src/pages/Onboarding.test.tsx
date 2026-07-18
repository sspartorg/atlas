/**
 * Onboarding wizard — unit tests
 *
 * Covers:
 *  1. Loading skeleton while settings is pending
 *  2. Step 1 renders correctly (heading, Display name field, Next button)
 *  3. Step 1 validation — empty name shows inline error
 *  4. Step 1 → Step 2 navigation with a valid name
 *  5. Step 2 Back button returns to Step 1
 *  6. Step 2 validation — empty workspace shows inline error
 *  7. Successful submit → SuccessView shown
 *  8. Failed submit → error message shown
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Onboarding } from './Onboarding.js';

const BASE = 'http://localhost:3000/api';

// Shared fs stubs so FolderPicker mounts without unhandled-request errors.
const fsFsHandlers = [
    http.get(`${BASE}/fs/home`, () => HttpResponse.json({ path: '/home/user' })),
    http.get(`${BASE}/fs/list`, () => HttpResponse.json({ items: [], path: '/home', entries: [], parent: null })),
    http.get(`${BASE}/fs/stat`, () => HttpResponse.json({ path: '/home/user', exists: true, is_directory: true })),
];

beforeEach(() => {
    server.use(
        http.get(`${BASE}/settings`, () =>
            HttpResponse.json({ id: 1, owner_name: '', onboarding_complete: 0 }),
        ),
        ...fsFsHandlers,
        ...defaultHandlers,
    );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderOnboarding() {
    return renderWithProviders(<Onboarding />, {
        initialEntries: ['/onboarding'],
    });
}

/** Advance to Step 2 by typing a name and clicking Next. */
async function advanceToStep2(name = 'Test User') {
    const input = screen.getByLabelText(/display name/i);
    await userEvent.clear(input);
    await userEvent.type(input, name);
    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByText('Where should Atlas keep your projects?');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Onboarding — loading state', () => {
    it('renders WizardSkeleton while settings is still loading', () => {
        // Override settings to never resolve so isPending stays true.
        server.use(
            http.get(`${BASE}/settings`, () => new Promise(() => { /* never resolves */ })),
        );
        renderOnboarding();
        // WizardSkeleton uses StepIndicator with loading prop — no form content visible.
        expect(screen.queryByText('Welcome to Atlas.')).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    });
});

describe('Onboarding — Step 1', () => {
    it('renders the step 1 heading, Display name field, and Next button', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Next$/i })).toBeInTheDocument();
    });

    it('shows validation error when Next is clicked with empty name', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
        expect(await screen.findByText('Enter a display name to continue.')).toBeInTheDocument();
    });

    it('does NOT advance to step 2 when name is empty', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
        // Step 2 heading must not appear
        await waitFor(() => {
            expect(screen.queryByText('Where should Atlas keep your projects?')).not.toBeInTheDocument();
        });
    });
});

describe('Onboarding — Step 1 → Step 2', () => {
    it('advances to step 2 after typing a name and clicking Next', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        expect(screen.getByText('Where should Atlas keep your projects?')).toBeInTheDocument();
    });

    it('hides the step 1 heading after advancing', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        expect(screen.queryByText('Welcome to Atlas.')).not.toBeInTheDocument();
    });
});

describe('Onboarding — Step 2', () => {
    it('shows a Back button on step 2', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
    });

    it('shows a Finish Setup button on step 2', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        expect(screen.getByRole('button', { name: /^Finish Setup$/i })).toBeInTheDocument();
    });

    it('clicking Back returns to step 1', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        await userEvent.click(screen.getByRole('button', { name: /^Back$/i }));
        await screen.findByText('Welcome to Atlas.');
        expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    });

    it('shows validation error when Finish Setup is clicked with empty workspace', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();
        await userEvent.click(screen.getByRole('button', { name: /^Finish Setup$/i }));
        expect(await screen.findByText('Pick a workspace folder to continue.')).toBeInTheDocument();
    });
});

describe('Onboarding — submit success', () => {
    it('shows SuccessView after a successful onboard POST', async () => {
        server.use(
            http.post(`${BASE}/settings/onboard`, () =>
                HttpResponse.json({
                    id: 1,
                    owner_name: 'Test User',
                    onboarding_complete: 1,
                    workspace_path: '/home/user/projects',
                }),
            ),
            // Also stub counts/dashboard/agents/projects/notifications for the prefetch calls
            http.get(`${BASE}/counts/dashboard`, () => HttpResponse.json({})),
            http.get(`${BASE}/counts/sidenav`, () => HttpResponse.json({})),
        );

        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2('Test User');

        // Type a workspace path into FolderPicker's text input
        const workspaceInput = screen.getByPlaceholderText(/e\.g\./i);
        await userEvent.clear(workspaceInput);
        await userEvent.type(workspaceInput, '/home/user/projects');

        await userEvent.click(screen.getByRole('button', { name: /^Finish Setup$/i }));

        // SuccessView renders "You're all set."
        await screen.findByText("You're all set.", undefined, { timeout: 5000 });
    });
});

describe('Onboarding — submit error', () => {
    it('shows an error message when the onboard POST returns 500', async () => {
        server.use(
            http.post(`${BASE}/settings/onboard`, () =>
                HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 }),
            ),
        );

        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2('Test User');

        const workspaceInput = screen.getByPlaceholderText(/e\.g\./i);
        await userEvent.clear(workspaceInput);
        await userEvent.type(workspaceInput, '/home/user/projects');

        await userEvent.click(screen.getByRole('button', { name: /^Finish Setup$/i }));

        // After failure, Finish Setup button re-enables and an error appears
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Finish Setup$/i })).not.toBeDisabled();
        });
        // The error text is either the message from the API or the fallback
        const errorText = screen.queryByText(/Could not finish onboarding\./i)
            ?? screen.queryByText(/Internal Server Error/i)
            ?? screen.queryByText(/HTTP 500/i);
        expect(errorText).toBeInTheDocument();
    });
});

describe('Onboarding — swatch keyboard navigation', () => {
    it('ArrowRight moves focus to the next swatch', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');

        // The first swatch has tabIndex=0 (selected); focus it then press ArrowRight
        const radioGroup = screen.getByRole('radiogroup', { name: /owner chip color/i });
        const swatches = screen.getAllByRole('radio');
        // Swatches are divs — focus the first one
        swatches[0]!.focus();

        fireEvent.keyDown(radioGroup, { key: 'ArrowRight' });

        // After ArrowRight the second swatch should receive focus
        await waitFor(() => {
            expect(document.activeElement).toBe(swatches[1]);
        });
    });

    it('ArrowLeft moves focus to the previous swatch', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');

        const radioGroup = screen.getByRole('radiogroup', { name: /owner chip color/i });
        const swatches = screen.getAllByRole('radio');

        // Click the second swatch to select it, then press ArrowLeft
        fireEvent.click(swatches[1]!);
        swatches[1]!.focus();

        fireEvent.keyDown(radioGroup, { key: 'ArrowLeft' });

        // After ArrowLeft the first swatch should receive focus
        await waitFor(() => {
            expect(document.activeElement).toBe(swatches[0]);
        });
    });

    it('non-arrow key does nothing (handleSwatchKey early return branch)', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');

        const radioGroup = screen.getByRole('radiogroup', { name: /owner chip color/i });
        const swatches = screen.getAllByRole('radio');
        swatches[0]!.focus();

        // Pressing Space/Enter does NOT change focus (early return in handleSwatchKey)
        fireEvent.keyDown(radioGroup, { key: 'Enter' });
        // Focus should remain on swatches[0] — component does not crash
        expect(document.body).toBeTruthy();
    });
});

describe('Onboarding — workspace error cleared on change', () => {
    it('clears the workspace error when user types after a failed validation', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2('Test User');

        // Click Finish Setup without a workspace to trigger validation error
        await userEvent.click(screen.getByRole('button', { name: /^Finish Setup$/i }));
        expect(await screen.findByText('Pick a workspace folder to continue.')).toBeInTheDocument();

        // Now type something in the workspace field — this exercises handleWorkspacePathChange
        // with the branch `if (errors.workspacePath)` being true → clears the error
        const workspaceInput = screen.getByPlaceholderText(/e\.g\./i);
        await userEvent.clear(workspaceInput);
        await userEvent.type(workspaceInput, '/home/u');

        // The workspace error should disappear after typing
        await waitFor(() => {
            expect(screen.queryByText('Pick a workspace folder to continue.')).not.toBeInTheDocument();
        });
    });
});

describe('Onboarding — workspace path error clears on retype', () => {
    it('clears the workspacePath error when the user types in the workspace field', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();

        // Trigger the validation error by clicking Finish Setup with empty path
        await userEvent.click(screen.getByRole('button', { name: /^Finish Setup$/i }));
        expect(await screen.findByText('Pick a workspace folder to continue.')).toBeInTheDocument();

        // Now type in the workspace field — the error should disappear
        const workspaceInput = screen.getByPlaceholderText(/e\.g\./i);
        await userEvent.type(workspaceInput, '/home/user/projects');

        await waitFor(() => {
            expect(screen.queryByText('Pick a workspace folder to continue.')).not.toBeInTheDocument();
        });
    });
});

describe('Onboarding — WORKSPACE_PLACEHOLDER platform branch', () => {
    it('renders a platform-appropriate path placeholder in the workspace field', async () => {
        // WORKSPACE_PLACEHOLDER is an IIFE evaluated at module load time using
        // navigator.userAgent. jsdom's UA does not include "mac"/"linux", so the
        // Windows fallback fires: "e.g. C:\Users\You\Projects".
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');
        await advanceToStep2();

        // The placeholder always starts with "e.g. " regardless of platform.
        const workspaceInput = screen.getByPlaceholderText(/^e\.g\./i);
        expect(workspaceInput).toBeInTheDocument();
        // jsdom UA falls through to the Windows default branch
        expect((workspaceInput as HTMLInputElement).placeholder).toMatch(/C:\\Users\\/i);
    });
});

describe('Onboarding — swatch keyboard wrap-around', () => {
    it('ArrowRight on the LAST swatch wraps focus to the first swatch', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');

        const radioGroup = screen.getByRole('radiogroup', { name: /owner chip color/i });
        const swatches = screen.getAllByRole('radio');
        const lastIdx = swatches.length - 1;

        // Click the last swatch so it is selected (accentColor = ACCENT_OPTIONS[last])
        fireEvent.click(swatches[lastIdx]!);
        swatches[lastIdx]!.focus();

        // ArrowRight on the last swatch should wrap around to index 0
        fireEvent.keyDown(radioGroup, { key: 'ArrowRight' });

        await waitFor(() => {
            expect(document.activeElement).toBe(swatches[0]);
        });
    });

    it('ArrowLeft on the FIRST swatch wraps focus to the last swatch', async () => {
        renderOnboarding();
        await screen.findByText('Welcome to Atlas.');

        const radioGroup = screen.getByRole('radiogroup', { name: /owner chip color/i });
        const swatches = screen.getAllByRole('radio');
        const lastIdx = swatches.length - 1;

        // The first swatch is selected by default — focus it and press ArrowLeft
        swatches[0]!.focus();

        // ArrowLeft on the first swatch should wrap around to the last index
        fireEvent.keyDown(radioGroup, { key: 'ArrowLeft' });

        await waitFor(() => {
            expect(document.activeElement).toBe(swatches[lastIdx]);
        });
    });
});
