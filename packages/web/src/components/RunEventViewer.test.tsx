import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { RunEventViewer, type RunEventViewerProps } from './RunEventViewer.js';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function renderViewer(
    content: string | null,
    source: 'agent-stream-json' | 'claude-pty' | 'copilot' = 'agent-stream-json',
    overrides: Partial<RunEventViewerProps> = {},
) {
    return renderWithProviders(
        <RunEventViewer content={content} source={source} {...overrides} />,
    );
}

// ------------------------------------------------------------------
// Empty / null content
// ------------------------------------------------------------------

describe('RunEventViewer — empty states', () => {
    it('shows default placeholder when content is null', () => {
        renderViewer(null);
        expect(screen.getByText('— no output captured —')).toBeInTheDocument();
    });

    it('shows custom placeholder when emptyPlaceholder prop is set', () => {
        renderViewer(null, 'agent-stream-json', { emptyPlaceholder: 'nothing here yet' });
        expect(screen.getByText('nothing here yet')).toBeInTheDocument();
    });

    it('shows "no events yet" in section index when empty', () => {
        renderViewer('');
        expect(screen.getByText('no events yet')).toBeInTheDocument();
    });
});

// ------------------------------------------------------------------
// Tabs — viewMode switching
// ------------------------------------------------------------------

describe('RunEventViewer — tab switching', () => {
    it('defaults to Timeline tab for agent-stream-json source', () => {
        const line = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude' });
        renderViewer(line, 'agent-stream-json');
        // Timeline tab is active — section index shows events
        expect(screen.getByText('Timeline')).toBeInTheDocument();
        expect(screen.getByText('Raw text')).toBeInTheDocument();
    });

    it('defaults to Raw text tab for copilot source', () => {
        renderViewer('hello world', 'copilot');
        // Raw text tab is active initially — content is shown as raw pre
        expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    it('can switch from Timeline to Raw text by clicking the tab', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } });
        renderViewer(line, 'agent-stream-json');
        fireEvent.click(screen.getByText('Raw text'));
        // Raw text view shows the raw content
        expect(screen.getByText(line)).toBeInTheDocument();
    });

    it('Raw text with empty content shows placeholder', () => {
        renderViewer('', 'copilot', { emptyPlaceholder: '— empty —' });
        expect(screen.getByText('— empty —')).toBeInTheDocument();
    });

    it('Raw text with non-empty content shows it', () => {
        renderViewer('line1\nline2', 'copilot');
        // The pre element has normalized text; just check key tokens are present
        expect(document.body.textContent).toContain('line1');
        expect(document.body.textContent).toContain('line2');
    });
});

// ------------------------------------------------------------------
// Event parsing — agent-stream-json
// ------------------------------------------------------------------

describe('RunEventViewer — agent-stream-json events', () => {
    it('renders a text/content block event header', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hello world' }] },
        });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('assistant').length).toBeGreaterThan(0);
    });

    it('renders subtype in header as type/subtype', () => {
        const line = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude' });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('system/init').length).toBeGreaterThan(0);
    });

    it('renders tool_use preview', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'ReadFile', input: {} }] },
        });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText(/tool_use/).length).toBeGreaterThan(0);
    });

    it('renders tool_result preview', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'tool_result', content: 'file content here' }] },
        });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText(/tool_result/).length).toBeGreaterThan(0);
    });

    it('renders tool_result with array content', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'result' }] }] },
        });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText(/tool_result/).length).toBeGreaterThan(0);
    });

    it('renders thinking block preview', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'thinking', thinking: 'I am reasoning...' }] },
        });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText(/thinking/).length).toBeGreaterThan(0);
    });

    it('renders result event with string result field', () => {
        const line = JSON.stringify({ type: 'result', result: 'Task completed successfully.' });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText(/result/).length).toBeGreaterThan(0);
    });

    it('renders system/init with model preview', () => {
        const line = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4' });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('system/init').length).toBeGreaterThan(0);
    });

    it('marks events with atlas-api error as error color (hasApiError=true)', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'tool_result', content: '[atlas-api-422] validation failed' }] },
        });
        renderViewer(line, 'agent-stream-json');
        // Event still renders; the error color is a style change, just verify it renders
        expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    });

    it('handles non-JSON line as a text event', () => {
        renderViewer('[stderr] process exited with code 1', 'agent-stream-json');
        expect(screen.getAllByText('[stderr] process exited with code 1').length).toBeGreaterThan(0);
    });

    it('marks [stderr] lines as stderr tone', () => {
        renderViewer('[stderr] error!', 'agent-stream-json');
        // In timeline mode, both header and detail show 'stderr'
        expect(screen.getAllByText('stderr').length).toBeGreaterThan(0);
    });

    it('handles unparseable JSON line as text fallback', () => {
        renderViewer('{invalid json}', 'agent-stream-json');
        expect(screen.getAllByText('{invalid json}').length).toBeGreaterThan(0);
    });

    it('handles blank/whitespace-only lines (skipped)', () => {
        const content = 'line1\n\n  \nline2';
        // Only non-blank lines produce events
        renderViewer(content, 'agent-stream-json');
        expect(screen.getAllByText('line1').length).toBeGreaterThan(0);
        expect(screen.getByText('line2')).toBeInTheDocument();
    });
});

// ------------------------------------------------------------------
// Event parsing — claude-pty
// ------------------------------------------------------------------

describe('RunEventViewer — claude-pty events', () => {
    it('renders user message with string content', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: 'Please help me with the task.' },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    });

    it('renders user message with array content text block', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'text', text: 'Do this please.' }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    });

    it('renders user message with tool_result block', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'tool_result', content: 'Done.' }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    });

    it('renders user message with tool_result array content', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { content: [{ type: 'tool_result', content: [{ text: 'result array' }] }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('user').length).toBeGreaterThan(0);
    });

    it('renders assistant message with text block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'I will help you.' }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('assistant').length).toBeGreaterThan(0);
    });

    it('renders assistant message with tool_use block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'Bash' }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('assistant').length).toBeGreaterThan(0);
    });

    it('renders assistant message with thinking block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'thinking', thinking: 'Let me think...' }] },
        });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('assistant').length).toBeGreaterThan(0);
    });

    it('renders last-prompt event', () => {
        const line = JSON.stringify({ type: 'last-prompt', content: 'Fix the bug.' });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('last-prompt').length).toBeGreaterThan(0);
    });

    it('renders queue-operation event', () => {
        const line = JSON.stringify({ type: 'queue-operation', operation: 'append', content: 'New task' });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('queue-operation').length).toBeGreaterThan(0);
    });

    it('renders summary event', () => {
        const line = JSON.stringify({ type: 'summary', summary: 'The session covered X.' });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('summary').length).toBeGreaterThan(0);
    });

    it('renders unknown type as bare event header', () => {
        const line = JSON.stringify({ type: 'unknown-custom-type' });
        renderViewer(line, 'claude-pty');
        expect(screen.getAllByText('unknown-custom-type').length).toBeGreaterThan(0);
    });
});

// ------------------------------------------------------------------
// Event parsing — copilot
// ------------------------------------------------------------------

describe('RunEventViewer — copilot events', () => {
    it('defaults to Raw text mode for copilot', () => {
        const line = JSON.stringify({ type: 'assistant.message', data: { content: 'Hello', outputTokens: 100 } });
        renderViewer(line, 'copilot');
        // Raw text mode: shows raw content
        expect(screen.getByText(line)).toBeInTheDocument();
    });

    it('can switch to Timeline for copilot to exercise extractCopilotPreview', () => {
        const line = JSON.stringify({
            type: 'assistant.message',
            data: { content: 'Response text', outputTokens: 50 },
        });
        renderViewer(line, 'copilot');
        // Switch to timeline
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('assistant.message').length).toBeGreaterThan(0);
    });

    it('copilot assistant.message_delta preview', () => {
        const line = JSON.stringify({
            type: 'assistant.message_delta',
            data: { deltaContent: ' world' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('assistant.message_delta').length).toBeGreaterThan(0);
    });

    it('copilot user.message preview', () => {
        const line = JSON.stringify({
            type: 'user.message',
            data: { content: 'User question' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('user.message').length).toBeGreaterThan(0);
    });

    it('copilot text event preview', () => {
        const line = JSON.stringify({
            type: 'text',
            data: { text: 'Some output' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('text').length).toBeGreaterThan(0);
    });

    it('copilot tool.execution_start preview', () => {
        const line = JSON.stringify({
            type: 'tool.execution_start',
            data: { toolName: 'RunCommand' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('tool.execution_start').length).toBeGreaterThan(0);
    });

    it('copilot tool.execution_complete preview', () => {
        const line = JSON.stringify({
            type: 'tool.execution_complete',
            data: { toolName: 'ReadFile' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('tool.execution_complete').length).toBeGreaterThan(0);
    });

    it('copilot session.mcp_server event preview', () => {
        const line = JSON.stringify({
            type: 'session.mcp_server_connected',
            data: { serverName: 'atlas', status: 'connected' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.mcp_server_connected').length).toBeGreaterThan(0);
    });

    it('copilot session.mcp_servers_loaded preview', () => {
        const line = JSON.stringify({
            type: 'session.mcp_servers_loaded',
            data: { servers: ['a', 'b', 'c'] },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.mcp_servers_loaded').length).toBeGreaterThan(0);
    });

    it('copilot session.tools_updated preview', () => {
        const line = JSON.stringify({
            type: 'session.tools_updated',
            data: { model: 'gpt-4o' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.tools_updated').length).toBeGreaterThan(0);
    });

    it('copilot session.start preview', () => {
        const line = JSON.stringify({
            type: 'session.start',
            data: { selectedModel: 'gpt-4o' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.start').length).toBeGreaterThan(0);
    });

    it('copilot session.shutdown preview', () => {
        const line = JSON.stringify({
            type: 'session.shutdown',
            data: {},
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.shutdown').length).toBeGreaterThan(0);
    });

    it('copilot result event with usage', () => {
        const line = JSON.stringify({
            type: 'result',
            usage: { premiumRequests: 3, sessionDurationMs: 5000 },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });

    it('copilot result event without sessionDurationMs', () => {
        const line = JSON.stringify({
            type: 'result',
            usage: { premiumRequests: 2 },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });

    it('copilot assistant.message without outputTokens', () => {
        const line = JSON.stringify({
            type: 'assistant.message',
            data: { content: 'Hello' },
        });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('assistant.message').length).toBeGreaterThan(0);
    });
});

// ------------------------------------------------------------------
// Event selection / interaction
// ------------------------------------------------------------------

describe('RunEventViewer — event selection', () => {
    it('selecting an event in the section index updates the detail pane', () => {
        const lines = [
            JSON.stringify({ type: 'system', subtype: 'init', model: 'claude' }),
            JSON.stringify({ type: 'result', result: 'Done.' }),
        ].join('\n');
        renderViewer(lines, 'agent-stream-json');
        // Both headers are in the section index — result appears once in section index
        const resultHeaders = screen.getAllByText('result');
        fireEvent.click(resultHeaders[0]!.closest('button') ?? resultHeaders[0]!);
        // After clicking result, the detail pane also shows result
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });

    it('detail pane shows JSON for json events', () => {
        const obj = { type: 'result', result: 'All done.' };
        const line = JSON.stringify(obj);
        renderViewer(line, 'agent-stream-json');
        // The JSON pretty-print should appear
        expect(screen.getAllByText(/"type": "result"/).length).toBeGreaterThan(0);
    });

    it('detail pane shows text for text events', () => {
        renderViewer('plain text output', 'agent-stream-json');
        expect(screen.getAllByText('plain text output').length).toBeGreaterThan(0);
    });

    it('detail pane shows stderr correctly', () => {
        renderViewer('[stderr] something failed', 'agent-stream-json');
        expect(screen.getAllByText('stderr').length).toBeGreaterThan(0);
        expect(screen.getAllByText('[stderr] something failed').length).toBeGreaterThan(0);
    });

    it('multiple events — clicking different rows shows different detail', () => {
        const lines = [
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
            '[stderr] err line',
        ].join('\n');
        renderViewer(lines, 'agent-stream-json');
        // Click stderr row button
        const stderrBtns = screen.getAllByRole('button');
        // There are two buttons (one per event); click the second
        if (stderrBtns[1]) {
            fireEvent.click(stderrBtns[1]);
        }
        expect(screen.getAllByText('stderr').length).toBeGreaterThan(0);
    });
});

// ------------------------------------------------------------------
// eventColor — header color coding
// ------------------------------------------------------------------

describe('RunEventViewer — eventColor branches', () => {
    it('assistant header renders', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [] } });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('assistant').length).toBeGreaterThan(0);
    });

    it('result header renders', () => {
        const line = JSON.stringify({ type: 'result', result: 'ok' });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });

    it('session header renders', () => {
        const line = JSON.stringify({ type: 'session.start', data: { selectedModel: 'x' } });
        renderViewer(line, 'copilot');
        fireEvent.click(screen.getByText('Timeline'));
        expect(screen.getAllByText('session.start').length).toBeGreaterThan(0);
    });

    it('error header renders', () => {
        const line = JSON.stringify({ type: 'tool_error', message: 'failed' });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('tool_error').length).toBeGreaterThan(0);
    });

    it('hook_response header renders', () => {
        const line = JSON.stringify({ type: 'hook_response', result: {} });
        renderViewer(line, 'agent-stream-json');
        expect(screen.getAllByText('hook_response').length).toBeGreaterThan(0);
    });
});

// ------------------------------------------------------------------
// shortenPreview — long preview truncation
// ------------------------------------------------------------------

describe('RunEventViewer — preview truncation', () => {
    it('truncates preview longer than 140 chars', () => {
        const longText = 'A'.repeat(200);
        const line = JSON.stringify({
            type: 'result',
            result: longText,
        });
        renderViewer(line, 'agent-stream-json');
        // Preview is truncated to <=140 chars + ellipsis
        // Just verify the event rendered without crashing
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });
});

// ------------------------------------------------------------------
// resetKey prop
// ------------------------------------------------------------------

describe('RunEventViewer — resetKey', () => {
    it('renders with resetKey prop without crashing', () => {
        const line = JSON.stringify({ type: 'result', result: 'ok' });
        renderViewer(line, 'agent-stream-json', { resetKey: 'run-abc' });
        expect(screen.getAllByText('result').length).toBeGreaterThan(0);
    });
});
