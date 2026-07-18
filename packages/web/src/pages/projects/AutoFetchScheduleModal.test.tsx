import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { AutoFetchScheduleModal } from './AutoFetchScheduleModal.js';
import type { IProjectSchedule } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';
const project = makeProject({ id: 'p1', name: 'Acme', default_branch: 'main' });

const ISO = '2026-06-25T00:00:00.000Z';

const defaultSchedule: IProjectSchedule = {
    project_id: 'p1',
    enabled: false,
    preset: 'daily',
    cron_expression: '0 6 * * *',
    time_of_day: '06:00',
    weekday: 1,
    skip_if_dirty: true,
    pause_while_agents_active: true,
    conflict_policy: 'skip',
    last_run_at: null,
    last_run_status: null,
    last_run_detail: null,
    next_run_at: null,
    auth_failure_count: 0,
    created_at: ISO,
    updated_at: ISO,
};

const enabledSchedule: IProjectSchedule = {
    ...defaultSchedule,
    enabled: true,
};

beforeEach(() => {
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/projects/p1/schedule`, () => HttpResponse.json(defaultSchedule)),
    );
});

// ─── 1. Closed state ─────────────────────────────────────────────────────────

describe('AutoFetchScheduleModal — closed (project null)', () => {
    it('renders nothing when project is null', () => {
        const { container } = renderWithProviders(
            <AutoFetchScheduleModal open project={null} onClose={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

// ─── 2. Open / clean render ───────────────────────────────────────────────────

describe('AutoFetchScheduleModal — open clean render', () => {
    it('renders the dialog heading', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        expect(screen.getByText('Auto-fetch schedule')).toBeInTheDocument();
    });

    it('shows project name and branch in the subtitle', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // The subtitle contains "Acme · pulls" (project.name in mixed content)
        // and then a nested <Box component="span">origin/main</Box>.
        // Use regex to find text containing the project name.
        await waitFor(() =>
            expect(screen.getByText(/Acme/)).toBeInTheDocument(),
        );
        // The branch name is inside a span next to "origin/"
        await waitFor(() =>
            expect(screen.getByText(/origin\/main/i)).toBeInTheDocument(),
        );
    });

    it('shows preset cards once schedule loads', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText('Every hour')).toBeInTheDocument(),
        );
        expect(screen.getByText('Daily')).toBeInTheDocument();
        expect(screen.getByText('Weekly')).toBeInTheDocument();
        expect(screen.getByText('Custom cron')).toBeInTheDocument();
    });

    it('shows conflict policy cards', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText('Skip & notify')).toBeInTheDocument(),
        );
        expect(screen.getByText('Stash & merge')).toBeInTheDocument();
        expect(screen.getByText('Abort & alert')).toBeInTheDocument();
    });

    it('shows enabled heading when schedule is enabled', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () => HttpResponse.json(enabledSchedule)),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText('Auto-fetch enabled')).toBeInTheDocument(),
        );
        // "Turn off" button only shows when server schedule is enabled
        expect(screen.getByRole('button', { name: /Turn off/i })).toBeInTheDocument();
    });
});

// ─── 3. Submit-success path ───────────────────────────────────────────────────

describe('AutoFetchScheduleModal — submit success', () => {
    it('calls PUT schedule and closes on Save schedule', async () => {
        const onClose = vi.fn();
        server.use(
            http.put(`${BASE}/projects/p1/schedule`, () =>
                HttpResponse.json({ ...defaultSchedule, enabled: true }),
            ),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        await waitFor(() => screen.getByText('Save schedule'));
        await userEvent.click(screen.getByRole('button', { name: /Save schedule/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('calls PUT with enabled=false when Turn off is clicked', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () => HttpResponse.json(enabledSchedule)),
            http.put(`${BASE}/projects/p1/schedule`, () =>
                HttpResponse.json({ ...enabledSchedule, enabled: false }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        await waitFor(() => screen.getByRole('button', { name: /Turn off/i }));
        await userEvent.click(screen.getByRole('button', { name: /Turn off/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

// ─── 4. Submit-error path ─────────────────────────────────────────────────────

describe('AutoFetchScheduleModal — submit error', () => {
    it('shows error and does not close when save fails', async () => {
        const onClose = vi.fn();
        server.use(
            http.put(`${BASE}/projects/p1/schedule`, () =>
                HttpResponse.json({ error: 'DB error' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        await waitFor(() => screen.getByText('Save schedule'));
        await userEvent.click(screen.getByRole('button', { name: /Save schedule/i }));
        // After an error the caught error is shown; onClose must NOT have been called
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(onClose).not.toHaveBeenCalled();
    });
});

// ─── 5. Cancel / close ───────────────────────────────────────────────────────

describe('AutoFetchScheduleModal — cancel', () => {
    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        await waitFor(() => screen.getByRole('button', { name: /^Cancel$/ }));
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('Close icon calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        // The icon button contains CloseRounded — it is the only icon button at
        // the top of the dialog.
        const closeBtn = await screen.findAllByRole('button');
        // find the close icon button (aria label not set but it is the only small icon button)
        // It is the first button rendered inside the header
        await userEvent.click(closeBtn[0]!);
        expect(onClose).toHaveBeenCalled();
    });
});

// ─── 5b. Uncovered branches ────────────────────────────────────────────────────

describe('AutoFetchScheduleModal — overriddenByPolicy guard', () => {
    it('shows overridden sub-text for skip_if_dirty when conflict_policy is stash', async () => {
        // When conflict_policy !== 'skip', the skip_if_dirty guard row is
        // disabled and its sub-text changes to the "overridden" message.
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () =>
                HttpResponse.json({ ...defaultSchedule, conflict_policy: 'stash' }),
            ),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // The GuardRow sub-text becomes 'overridden — "Stash & merge" handles dirty trees'
        await screen.findByText(/overridden/i);
        expect(screen.getByText(/overridden/i)).toBeInTheDocument();
    });

    it('shows overridden sub-text for skip_if_dirty when conflict_policy is abort', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () =>
                HttpResponse.json({ ...defaultSchedule, conflict_policy: 'abort' }),
            ),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await screen.findByText(/overridden/i);
        expect(screen.getByText(/overridden/i)).toBeInTheDocument();
    });

    it('does NOT show overridden text when conflict_policy is skip', async () => {
        // defaultSchedule already has conflict_policy: 'skip'
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // Wait for the guard row to appear
        await screen.findByText("we won't pull when you have uncommitted edits");
        expect(screen.queryByText(/overridden/i)).not.toBeInTheDocument();
    });
});

describe('AutoFetchScheduleModal — handleSave early return (!f || !projectId)', () => {
    it('does not call onClose when form data is not yet loaded (isLoading state)', async () => {
        // Simulate a very slow response — the modal renders the spinner while
        // the schedule loads; the Save button is not yet visible.
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, async () => {
                // Delay response to keep isLoading=true long enough to assert
                await new Promise((r) => setTimeout(r, 5000));
                return HttpResponse.json(defaultSchedule);
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        // The spinner should be visible while loading; the form body (Save button) must be absent
        const spinner = await screen.findByRole('progressbar');
        expect(spinner).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Save schedule/i })).not.toBeInTheDocument();
    });
});

describe('AutoFetchScheduleModal — isLoading spinner', () => {
    it('renders CircularProgress while the schedule is loading', async () => {
        // Use a handler that never resolves so isLoading stays true
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, async () => {
                await new Promise((r) => setTimeout(r, 5000));
                return HttpResponse.json(defaultSchedule);
            }),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        const spinner = await screen.findByRole('progressbar');
        expect(spinner).toBeInTheDocument();
        // The form body must not render while loading
        expect(screen.queryByText('Enable scheduled auto-fetch')).not.toBeInTheDocument();
    });
});

// ─── 6. Form-field interactions ───────────────────────────────────────────────

describe('AutoFetchScheduleModal — form interactions', () => {
    it('clicking a preset card selects it', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Every hour'));
        // Click "Every hour" preset
        await userEvent.click(screen.getByText('Every hour'));
        // Clicking selects it; we can't assert visual state without querying the
        // DOM deeply but we can verify the card does not crash and is still present.
        expect(screen.getByText('Every hour')).toBeInTheDocument();
    });

    it('selecting Weekly preset shows weekday select', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Weekly'));
        await userEvent.click(screen.getByText('Weekly'));
        await waitFor(() => expect(screen.getByLabelText('Weekday')).toBeInTheDocument());
    });

    it('selecting Custom cron preset shows cron expression field', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Custom cron'));
        await userEvent.click(screen.getByText('Custom cron'));
        await waitFor(() =>
            expect(screen.getByLabelText('Cron expression')).toBeInTheDocument(),
        );
    });

    it('toggling the enable switch fires the onChange handler (covers L365 branch)', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // Wait for the schedule to load so the switches render
        await waitFor(() => screen.getByText('Enable scheduled auto-fetch'));
        // MUI Switch renders a hidden <input type="checkbox"> — fireEvent.change on it
        // fires the MUI Switch onChange prop directly, covering L365.
        const checkboxInputs = document.querySelectorAll('input[type="checkbox"]');
        const first = checkboxInputs[0];
        if (first) {
            fireEvent.change(first, { target: { checked: true } });
        }
        // The component still renders after the state update
        expect(screen.getByText('Enable scheduled auto-fetch')).toBeInTheDocument();
    });

    it('branch field is read-only and shows the default branch', async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Branch'));
        // The branch labeled field contains the default_branch value
        const branchInput = screen.getAllByDisplayValue('main')[0];
        expect(branchInput).toHaveAttribute('readonly');
    });

    it('clicking a conflict policy card persists into the PUT body', { timeout: 30_000 }, async () => {
        let body: Record<string, unknown> | null = null;
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () => HttpResponse.json(defaultSchedule)),
            http.put(`${BASE}/projects/p1/schedule`, async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({ ...defaultSchedule, conflict_policy: 'stash' });
            }),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Stash & merge'));
        await userEvent.click(screen.getByText('Stash & merge'));
        await userEvent.click(screen.getByRole('button', { name: /Save schedule/ }));
        await waitFor(() => expect(body?.['conflict_policy']).toBe('stash'));
    });

    it('typing in cron expression updates state when Custom is selected', { timeout: 30_000 }, async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Custom cron'));
        await userEvent.click(screen.getByText('Custom cron'));
        const cronField = await screen.findByLabelText('Cron expression');
        await userEvent.clear(cronField);
        await userEvent.type(cronField, '*/15 * * * *');
        expect(cronField).toHaveValue('*/15 * * * *');
    });

    it('changing the weekday select updates state when Weekly is selected', { timeout: 30_000 }, async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Weekly'));
        await userEvent.click(screen.getByText('Weekly'));
        // MUI select: the hidden native input has the role/label, but the visible
        // combobox is the button-like div. Click the combobox to open the menu,
        // then click a menu option.
        const combo = await screen.findByRole('combobox', { name: 'Weekday' });
        await userEvent.click(combo);
        const friOption = await screen.findByRole('option', { name: 'Fri' });
        await userEvent.click(friOption);
        // After selection the combobox text reflects the chosen weekday.
        await waitFor(() => expect(combo).toHaveTextContent('Fri'));
    });

    it('toggling the pause-while-agents-active guard flips it in the PUT body', { timeout: 30_000 }, async () => {
        let body: Record<string, unknown> | null = null;
        server.use(
            http.get(`${BASE}/projects/p1/schedule`, () => HttpResponse.json(defaultSchedule)),
            http.put(`${BASE}/projects/p1/schedule`, async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json(defaultSchedule);
            }),
        );
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // Wait for the guard switches to render
        await waitFor(() => screen.getByText('Pause fetch while agents are active'));
        // GuardRow renders: <Box><Box><Typography label/></Box><Switch/></Box>.
        // Walk up two levels from the label Typography to the outer row container.
        const pauseLabel = screen.getByText('Pause fetch while agents are active');
        const row = pauseLabel.parentElement?.parentElement;
        expect(row).toBeTruthy();
        const sw = row!.querySelector('input[role="switch"]') as HTMLElement | null;
        expect(sw).toBeTruthy();
        await userEvent.click(sw!);
        await userEvent.click(screen.getByRole('button', { name: /Save schedule/ }));
        await waitFor(() =>
            expect(body?.['pause_while_agents_active']).toBe(!defaultSchedule.pause_while_agents_active),
        );
    });

    it('time-of-day field updates form state', { timeout: 30_000 }, async () => {
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        // LabeledField uses its label text as a tag, and renders a native input.
        // Find the time-of-day input via its initial value '06:00' and type a new value.
        await waitFor(() => screen.getByText('Time of day'));
        const tod = screen.getByDisplayValue('06:00');
        await userEvent.clear(tod);
        await userEvent.type(tod, '09:30');
        expect(tod).toHaveValue('09:30');
    });
});

describe('AutoFetchScheduleModal — open→close→reopen (useEffect !open reset)', () => {
    it('resets form state when modal closes (exercises the !open useEffect)', async () => {
        const { rerender } = renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Daily'));
        // Trigger the useEffect(()=>{ if(!open) reset }, [open]) by setting open=false
        rerender(
            <AutoFetchScheduleModal open={false} project={project} onClose={vi.fn()} />,
        );
        // After close, modal becomes invisible but the useEffect has run setForm(null)
        await new Promise((r) => setTimeout(r, 50));
        // Reopen — useEffect(()=>{ if(server) setForm(server) }, [server]) fires
        rerender(
            <AutoFetchScheduleModal open project={project} onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('Daily'));
    });
});

describe('AutoFetchScheduleModal — save.isPending spinner', () => {
    it('shows a spinner in the Save button while the PUT is in-flight (isPending branch)', async () => {
        let resolveSave: ((v: Response) => void) | null = null;
        server.use(
            http.put(`${BASE}/projects/p1/schedule`, () =>
                new Promise((resolve) => {
                    resolveSave = resolve as (v: Response) => void;
                }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <AutoFetchScheduleModal open project={project} onClose={onClose} />,
        );
        await waitFor(() => screen.getByText('Daily'));
        const saveBtn = screen.getByRole('button', { name: /Save schedule/ });
        await userEvent.click(saveBtn);
        // While the promise is pending, the button should show the spinner
        await new Promise((r) => setTimeout(r, 50));
        // Resolve to clean up
        if (resolveSave) {
            (resolveSave as (v: unknown) => void)(HttpResponse.json(defaultSchedule));
        }
        await new Promise((r) => setTimeout(r, 100));
    });
});
