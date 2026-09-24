import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IRunTraceSummary } from '@atlas/shared';
import { RunTracePanel } from './RunTracePanel.js';

function trace(over: Partial<IRunTraceSummary> = {}): IRunTraceSummary {
    return {
        source: 'claude',
        turns: 12,
        tool_calls: 20,
        tools: { Read: 9, Bash: 7, Edit: 4 },
        tool_sequence: ['Read', 'Bash'],
        thinking_blocks: 3,
        subagent_turns: 0,
        files_touched: ['src/a.ts', 'src/b.ts'],
        errors: 0,
        ttft_ms: 2800,
        truncated: false,
        ...over,
    };
}

describe('RunTracePanel', () => {
    it('shows what the agent did', () => {
        render(<RunTracePanel trace={trace()} />);
        expect(screen.getByText('How it worked')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('20')).toBeInTheDocument();
        expect(screen.getByText('Read')).toBeInTheDocument();
        expect(screen.getByText('src/a.ts')).toBeInTheDocument();
        expect(screen.getByText('2.8s')).toBeInTheDocument();
    });

    // Every run that finished before migration 017. An empty panel would read
    // as "this run did nothing", which is a different claim entirely.
    it('renders nothing at all when there is no trace', () => {
        const { container } = render(<RunTracePanel trace={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    // Copilot reports tool names but not their arguments, so the files are
    // genuinely unknown. Showing "0 files" would be a claim nobody made.
    it('says which fields this CLI could not report', () => {
        render(
            <RunTracePanel
                trace={trace({ source: 'copilot', files_touched: null, thinking_blocks: null })}
            />,
        );
        expect(screen.getByText(/does not report files touched or thinking/i)).toBeInTheDocument();
        expect(screen.queryByText('Files touched')).not.toBeInTheDocument();
    });

    it('hides counters that would read as a claim of zero', () => {
        render(<RunTracePanel trace={trace({ errors: 0, subagent_turns: 0 })} />);
        expect(screen.queryByText('tool errors')).not.toBeInTheDocument();
        expect(screen.queryByText('sub-agent')).not.toBeInTheDocument();
    });

    it('shows tool errors when there were some', () => {
        render(<RunTracePanel trace={trace({ errors: 2 })} />);
        expect(screen.getByText('tool errors')).toBeInTheDocument();
    });

    it('collapses a long tool list instead of running off the card', () => {
        const tools = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Tool${i}`, 9 - i]));
        render(<RunTracePanel trace={trace({ tools })} />);
        expect(screen.getByText(/\+ 3 more tools, 6 calls/)).toBeInTheDocument();
    });

    it('says when the run was long enough to be cut short', () => {
        render(<RunTracePanel trace={trace({ truncated: true })} />);
        expect(screen.getByText(/first part of it/i)).toBeInTheDocument();
    });

    it('renders milliseconds for a fast first token', () => {
        render(<RunTracePanel trace={trace({ ttft_ms: 420 })} />);
        expect(screen.getByText('420ms')).toBeInTheDocument();
    });

    // An agent that called nothing is a real outcome — a reviewer that read
    // the thread and answered without reaching for a tool.
    it('renders a run that used no tools at all', () => {
        render(<RunTracePanel trace={trace({ tools: {}, tool_calls: 0, files_touched: [] })} />);
        expect(screen.getByText('How it worked')).toBeInTheDocument();
        expect(screen.queryByText('Files touched')).not.toBeInTheDocument();
    });

    it('collapses a single extra tool in the singular', () => {
        const tools = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`T${i}`, 7 - i]));
        render(<RunTracePanel trace={trace({ tools })} />);
        expect(screen.getByText(/\+ 1 more tool, 1 calls/)).toBeInTheDocument();
    });

    it('caps a long file list and says how many more there were', () => {
        const files = Array.from({ length: 12 }, (_, i) => `src/file-${i}.ts`);
        render(<RunTracePanel trace={trace({ files_touched: files })} />);
        expect(screen.getByText('+ 4 more')).toBeInTheDocument();
    });

    it('counts sub-agent turns when the run spawned one', () => {
        render(<RunTracePanel trace={trace({ subagent_turns: 3 })} />);
        expect(screen.getByText('sub-agent')).toBeInTheDocument();
    });

    it('omits time to first token when it was never measured', () => {
        render(<RunTracePanel trace={trace({ ttft_ms: null })} />);
        expect(screen.queryByText('first token')).not.toBeInTheDocument();
    });

    it('renders a trace whose tools are all equally busy', () => {
        render(<RunTracePanel trace={trace({ tools: { Read: 1, Bash: 1 } })} />);
        expect(screen.getByText('Read')).toBeInTheDocument();
        expect(screen.getByText('Bash')).toBeInTheDocument();
    });
});
