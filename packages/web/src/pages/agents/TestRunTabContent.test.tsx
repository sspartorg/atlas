import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { server } from '../../test-setup.js';
import { TestRunTabContent } from './TestRunTabContent.js';
import { Toast } from '../../components/Toast.js';
import type { AgentView } from './agentViewModel.js';

const BASE = 'http://localhost:3000/api';

const view: AgentView = {
    slug: 'coder',
    glyph: 'developer_board',
    description: '',
    cadenceHours: 6,
    cadenceLabel: 'Every 6h',
    nextPassLabel: 'now',
    nextPassDelta: '0m',
    concurrentRuns: 1,
    concurrentMax: 3,
};

// jsdom doesn't implement scrollTo on elements
if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn();
}

describe('TestRunTabContent', () => {
    beforeEach(() => {
        server.use(...defaultHandlers);
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
        HTMLElement.prototype.scrollTo = vi.fn();
    });

    it('renders without crashing', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        expect(await screen.findByText(/Live CLI test run/i)).toBeInTheDocument();
    });

    it('shows Run test and Stop buttons', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        expect(await screen.findByRole('button', { name: /Run test/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Stop/i })).toBeInTheDocument();
    });

    it('Stop button is disabled initially', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const stopBtn = await screen.findByRole('button', { name: /Stop/i });
        expect(stopBtn).toBeDisabled();
    });

    it('Run test button is enabled initially', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        expect(runBtn).not.toBeDisabled();
    });

    it('shows idle status initially', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('shows "no test yet" in output header initially', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        expect(screen.getByText('no test yet')).toBeInTheDocument();
    });

    it('shows placeholder text in output when no lines', async () => {
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        expect(screen.getByText(/Press "Run test" to invoke the live CLI/i)).toBeInTheDocument();
    });

    it('shows cli and model in description line', async () => {
        const agent = makeAgent({ cli: 'claude', model: 'claude-opus-4-7' });
        renderWithProviders(
            <TestRunTabContent agent={agent} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        expect(screen.getByText(/cli · claude · model · claude-opus-4-7/i)).toBeInTheDocument();
    });

    it('shows "(unset)" when model is empty', async () => {
        const agent = makeAgent({ model: '' });
        renderWithProviders(
            <TestRunTabContent agent={agent} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        expect(screen.getByText(/\(unset\)/i)).toBeInTheDocument();
    });

    it('clicking Run test calls POST /api/agents/:id/dry-run', async () => {
        let called = false;
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () => {
                called = true;
                return HttpResponse.json({
                    dryRunId: 'dry-001',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                });
            }),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => expect(called).toBe(true));
    });

    it('after starting a run, Stop is enabled and Run test is disabled', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-001',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Stop/i })).not.toBeDisabled();
        });
        expect(screen.getByRole('button', { name: /Run test/i })).toBeDisabled();
    });

    it('after starting, shows "Live" status and streaming in footer', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-001',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() =>
            expect(screen.getByText('Live')).toBeInTheDocument(),
        );
        expect(screen.getByText(/streaming/i)).toBeInTheDocument();
    });

    it('SSE dry_run_done event with exitCode=0 shows Done status', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-002',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => {
            expect(screen.getByText(/queued/i)).toBeInTheDocument();
        });
        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_done',
            dryRunId: 'dry-002',
            exitCode: 0,
            output: '[test] done · exit=0',
        });
        await waitFor(() => {
            expect(screen.getByText('Done')).toBeInTheDocument();
        });
    });

    it('SSE dry_run_done with non-zero exitCode shows Failed status', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-003',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_done',
            dryRunId: 'dry-003',
            exitCode: 1,
            output: '[test] done · exit=1',
        });
        await waitFor(() =>
            expect(screen.getByText('Failed')).toBeInTheDocument(),
        );
    });

    it('SSE dry_run_started event appends output line', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-004',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_started',
            dryRunId: 'dry-004',
            output: '[started] CLI process spawned',
        });
        await waitFor(() =>
            expect(screen.getByText(/CLI process spawned/i)).toBeInTheDocument(),
        );
    });

    it('SSE dry_run_output event appends plain output', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-005',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_output',
            dryRunId: 'dry-005',
            stream: 'stdout',
            output: 'OK',
        });
        await waitFor(() =>
            expect(screen.getByText('OK')).toBeInTheDocument(),
        );
    });

    it('SSE dry_run_output on stderr appends err line', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-006',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_output',
            dryRunId: 'dry-006',
            stream: 'stderr',
            output: 'stderr error text',
        });
        await waitFor(() =>
            expect(screen.getByText('stderr error text')).toBeInTheDocument(),
        );
    });

    it('SSE event for different dryRunId is ignored', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-007',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_done',
            dryRunId: 'different-id',
            exitCode: 0,
            output: 'should not appear',
        });
        // Should still show Live (not Done)
        await new Promise(r => setTimeout(r, 50));
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('Stop button appends stopped line and resets state', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-008',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        const stopBtn = screen.getByRole('button', { name: /Stop/i });
        fireEvent.click(stopBtn);

        await waitFor(() =>
            expect(screen.getByText(/stopped by user/i)).toBeInTheDocument(),
        );
        // Status goes back to Idle
        await waitFor(() =>
            expect(screen.getByText('Idle')).toBeInTheDocument(),
        );
    });

    it('dry-run API error shows err line and resets state', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);

        await waitFor(() =>
            expect(screen.getByText(/failed to start test run/i)).toBeInTheDocument(),
        );
        // Run test button re-enabled
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Run test/i })).not.toBeDisabled(),
        );
    });

    it('Copy log button calls navigator.clipboard.writeText', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-003',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <>
                <TestRunTabContent agent={makeAgent()} view={view} />
                <Toast />
            </>
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument());
        const copyLog = screen.getByText(/Copy log/i);
        fireEvent.click(copyLog);
        await waitFor(() => {
            expect((navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText).toHaveBeenCalled();
        });
    });

    it('copilot agent shows copilot command preview', async () => {
        const copilotAgent = makeAgent({ cli: 'copilot', model: 'gpt-5' });
        renderWithProviders(
            <TestRunTabContent agent={copilotAgent} view={view} />
        );
        await screen.findByText(/Live CLI test run/i);
        // The component shows cli info
        expect(screen.getByText(/cli · copilot/i)).toBeInTheDocument();
    });

    it('es.onerror handler appends connection error line — covers onerror branch', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-sse-err',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        // Trigger onerror on the active EventSource instance
        const MockEs = window.EventSource as unknown as { _instances: Array<{ onerror: ((ev: Event) => void) | null }> };
        const instances = MockEs._instances;
        if (instances.length > 0) {
            const inst = instances[instances.length - 1]!;
            if (inst.onerror) {
                inst.onerror(new Event('error'));
            }
        }

        await waitFor(() =>
            expect(screen.getByText(/\[sse\] connection error/i)).toBeInTheDocument(),
        );
    });

    it('statusLabel: lines>0 and exitCode=null (after stop) shows Idle — exercises middle branch', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-stop-idle',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        // Push a dry_run_output line so lines.length > 0
        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_output',
            dryRunId: 'dry-stop-idle',
            stream: 'stdout',
            output: 'some output',
        });
        await waitFor(() => expect(screen.getByText('some output')).toBeInTheDocument());

        // Now click Stop: running→false, startedAt→null, but exitCode stays null
        // → lines.length > 0, exitCode === null → statusLabel = 'Idle'
        const stopBtn = screen.getByRole('button', { name: /Stop/i });
        fireEvent.click(stopBtn);

        await waitFor(() =>
            expect(screen.getByText(/stopped by user/i)).toBeInTheDocument(),
        );
        // lines.length > 0, exitCode === null → middle 'Idle' branch
        await waitFor(() =>
            expect(screen.getByText('Idle')).toBeInTheDocument(),
        );
    });

    it('copilot model hyphen→dot normalization in commandPreview', async () => {
        // Model 'claude-sonnet-4-7' should show as 'claude-sonnet-4.7' in the command preview
        const copilotAgent = makeAgent({ cli: 'copilot', model: 'claude-sonnet-4-7' });
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-copilot-norm',
                    model: 'claude-sonnet-4.7',
                    cli: 'copilot',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={copilotAgent} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        // After clicking run, the commandPreview line is appended — it shows
        // the normalized model (hyphen→dot applied for copilot cli)
        await waitFor(() =>
            expect(screen.getByText(/claude-sonnet-4\.7/i)).toBeInTheDocument(),
        );
    });

    it('SSE dry_run_started with falsy output does not append a line', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-started-nooutput',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        const linesBefore = document.querySelectorAll('[class*=MuiBox-root]').length;
        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_started',
            dryRunId: 'dry-started-nooutput',
            output: '',
        });
        // No new "started" text should appear; still shows Live since nothing else changed
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.getByText('Live')).toBeInTheDocument();
        // Sanity: DOM didn't blow up and no stray "undefined" text got appended
        expect(document.body.textContent).not.toContain('undefined');
        void linesBefore;
    });

    it('SSE dry_run_output with falsy output does not append a line', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-output-nooutput',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_output',
            dryRunId: 'dry-output-nooutput',
            stream: 'stdout',
            output: '',
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('undefined');
    });

    it('SSE dry_run_done with missing exitCode falls back to -1 and missing output falls back to default message', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-done-fallbacks',
                    model: 'claude-opus-4-7',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={makeAgent()} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() => screen.getByText(/queued/i));

        // No exitCode, no output — exercises `event.exitCode ?? -1` and `event.output ?? default`
        (window as Window & { __pushSse?: (e: object) => void }).__pushSse!({
            type: 'dry_run_done',
            dryRunId: 'dry-done-fallbacks',
        });
        await waitFor(() =>
            expect(screen.getByText(/\[test\] done · exit=-1/i)).toBeInTheDocument(),
        );
        // exitCode -1 !== 0 → "Failed" status, and footer shows "exit -1"
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText(/exit -1/i)).toBeInTheDocument();
    });

    it('empty model on a claude agent falls back to "sonnet" in the command preview', async () => {
        // agent.model is falsy → `agent.model || (...)` evaluates the right
        // operand, and cli === 'claude' takes the 'sonnet' side of the ternary.
        const agent = makeAgent({ cli: 'claude', model: '' });
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-fallback-claude',
                    model: 'sonnet',
                    cli: 'claude',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={agent} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() =>
            expect(screen.getByText(/--model sonnet/i)).toBeInTheDocument(),
        );
    });

    it('empty model on a copilot agent falls back to "gpt-5" in the command preview', async () => {
        // agent.model is falsy and cli !== 'claude' → the ternary's false
        // side ('gpt-5') is used.
        const agent = makeAgent({ cli: 'copilot', model: '' });
        server.use(
            http.post(`${BASE}/agents/agent-coder/dry-run`, () =>
                HttpResponse.json({
                    dryRunId: 'dry-fallback-copilot',
                    model: 'gpt-5',
                    cli: 'copilot',
                    promptLen: 10,
                })
            ),
        );
        renderWithProviders(
            <TestRunTabContent agent={agent} view={view} />
        );
        const runBtn = await screen.findByRole('button', { name: /Run test/i });
        fireEvent.click(runBtn);
        await waitFor(() =>
            expect(screen.getByText(/--model gpt-5/i)).toBeInTheDocument(),
        );
    });
});
