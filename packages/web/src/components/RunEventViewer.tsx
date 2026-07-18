import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';

// Master-detail NDJSON viewer used by both the agent-run detail page and
// the terminal-history page. The two pages emit slightly different NDJSON
// schemas — see `RunEventSource` below — but share the same UX:
//   - A left/top "section index" of every event with a colored header
//     + 1-line preview.
//   - A right/bottom detail pane showing the selected event's raw JSON
//     (or plain text for non-JSON lines like `[stderr] ...`).
//   - A Tabs toggle: Timeline (master-detail) vs Raw text (full dump).
//
// Previously this UI lived inline in `AgentRunDetail.tsx`, and the
// terminal history page rendered a separate, less-good viewer
// (`JsonlTranscriptViewer.tsx`). Both have been collapsed into this
// component; passing `source` switches the per-event preview extractor.

const PREVIEW_MAX = 140;

// MCP api-client prefixes 4xx error messages with `[atlas-api-NNN]` so a
// tool_result event carrying a Zod/validation failure surfaces as a red
// flag in the section index. Match anywhere in the raw line — the marker
// can sit inside an escaped JSON string. Applies only to agent-runner
// output; PTY-mode and copilot session events don't carry these markers
// but the regex is harmless on them.
const ATLAS_API_ERROR_RE = /\[atlas-api-\d{3}\]/;

export type RunEventSource = 'agent-stream-json' | 'claude-pty' | 'copilot';

export type RunEvent =
    | {
          kind: 'json';
          raw: string;
          obj: Record<string, unknown>;
          header: string;
          preview: string;
          hasApiError: boolean;
      }
    | { kind: 'text'; text: string; tone: 'normal' | 'stderr' };

function shortenPreview(s: string): string {
    const trimmed = s.replace(/\s+/g, ' ').trim();
    return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX - 1)}…` : trimmed;
}

// Agent-runner stream-json preview: messages carry typed content blocks
// (text / tool_use / tool_result / thinking). `result` events carry the
// final natural-language wrap-up. `system / subtype:init` carries model.
function extractStreamJsonPreview(obj: Record<string, unknown>): string {
    const message = obj['message'] as { content?: unknown } | undefined;
    if (Array.isArray(message?.content)) {
        for (const b of message.content as Array<Record<string, unknown>>) {
            if (b['type'] === 'text' && typeof b['text'] === 'string' && (b['text'] as string).trim()) {
                return shortenPreview(b['text'] as string);
            }
            if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
                return shortenPreview(`tool_use · ${b['name'] as string}`);
            }
            if (b['type'] === 'tool_result') {
                const c = b['content'];
                const inner = typeof c === 'string' ? c : Array.isArray(c) ? JSON.stringify(c) : '';
                return shortenPreview(`tool_result · ${inner}`);
            }
            if (b['type'] === 'thinking' && typeof b['thinking'] === 'string' && (b['thinking'] as string).trim()) {
                return shortenPreview(`thinking · ${b['thinking'] as string}`);
            }
        }
    }
    if (typeof obj['result'] === 'string') return shortenPreview(obj['result'] as string);
    if (obj['subtype'] === 'init' && typeof obj['model'] === 'string') {
        return shortenPreview(`model=${obj['model'] as string}`);
    }
    return '';
}

// Claude PTY-mode session JSONL preview: `{"type":"user","message":{...}}`
// and `{"type":"assistant","message":{...}}` with `message.content` as
// either a string or an array of content blocks. Atlas-side synthetic
// events (`last-prompt`, `queue-operation`, `summary`) also appear.
function extractClaudePtyPreview(obj: Record<string, unknown>): string {
    const type = String(obj['type'] ?? '');
    const message = obj['message'] as { content?: unknown } | undefined;
    if (type === 'user') {
        if (typeof message?.content === 'string') return shortenPreview(message.content);
        if (Array.isArray(message?.content)) {
            for (const block of message.content as Array<Record<string, unknown>>) {
                if (block['type'] === 'text' && typeof block['text'] === 'string') {
                    return shortenPreview(block['text'] as string);
                }
                if (block['type'] === 'tool_result') {
                    const c = block['content'];
                    const inner = typeof c === 'string' ? c : Array.isArray(c) ? JSON.stringify(c) : '';
                    return shortenPreview(`tool_result · ${inner}`);
                }
            }
        }
        return '';
    }
    if (type === 'assistant') {
        if (Array.isArray(message?.content)) {
            for (const block of message.content as Array<Record<string, unknown>>) {
                if (block['type'] === 'text' && typeof block['text'] === 'string') {
                    return shortenPreview(block['text'] as string);
                }
                if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
                    return shortenPreview(`tool_use · ${block['name'] as string}`);
                }
                if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
                    return shortenPreview(`thinking · ${block['thinking'] as string}`);
                }
            }
        }
        return '';
    }
    if (type === 'last-prompt' && typeof obj['content'] === 'string') {
        return shortenPreview(obj['content'] as string);
    }
    if (type === 'queue-operation' && typeof obj['content'] === 'string') {
        const op = String(obj['operation'] ?? '');
        return shortenPreview(`${op} · ${obj['content']}`);
    }
    if (type === 'summary' && typeof obj['summary'] === 'string') {
        return shortenPreview(obj['summary'] as string);
    }
    return '';
}

// Copilot CLI preview: flat `data` object with type-specific fields.
function extractCopilotPreview(obj: Record<string, unknown>): string {
    const data = obj['data'] as Record<string, unknown> | undefined;
    if (data) {
        const type = typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
        if (type === 'assistant.message' && typeof data['content'] === 'string') {
            const tokens =
                typeof data['outputTokens'] === 'number' ? ` · ${data['outputTokens']} tok` : '';
            return shortenPreview(`${data['content']}${tokens}`);
        }
        if (type === 'assistant.message_delta' && typeof data['deltaContent'] === 'string') {
            return shortenPreview(`Δ ${data['deltaContent']}`);
        }
        if (type === 'user.message' && typeof data['content'] === 'string') {
            return shortenPreview(data['content'] as string);
        }
        if (type === 'text' && typeof data['text'] === 'string') {
            return shortenPreview(data['text'] as string);
        }
        if (type === 'tool.execution_start' && typeof data['toolName'] === 'string') {
            return shortenPreview(`▶ ${data['toolName'] as string}`);
        }
        if (type === 'tool.execution_complete' && typeof data['toolName'] === 'string') {
            return shortenPreview(`✓ ${data['toolName'] as string}`);
        }
        if (type.startsWith('session.mcp_server') && typeof data['serverName'] === 'string') {
            const status = typeof data['status'] === 'string' ? data['status'] : '';
            return shortenPreview(`${data['serverName']} · ${status}`);
        }
        if (type === 'session.mcp_servers_loaded' && Array.isArray(data['servers'])) {
            return shortenPreview(`${(data['servers'] as unknown[]).length} server(s)`);
        }
        if (type === 'session.tools_updated' && typeof data['model'] === 'string') {
            return shortenPreview(`model=${data['model']}`);
        }
        if (type === 'session.start' && typeof data['selectedModel'] === 'string') {
            return shortenPreview(`model=${data['selectedModel'] as string}`);
        }
        if (type === 'session.shutdown') {
            return 'session ended';
        }
    }
    // Top-level usage on copilot `result` event.
    if (obj['type'] === 'result') {
        const usage = obj['usage'] as Record<string, unknown> | undefined;
        if (usage && typeof usage['premiumRequests'] === 'number') {
            const dur =
                typeof usage['sessionDurationMs'] === 'number'
                    ? ` · ${Math.round((usage['sessionDurationMs'] as number) / 1000)}s`
                    : '';
            return shortenPreview(`${usage['premiumRequests']} premium req${dur}`);
        }
    }
    return '';
}

function extractPreview(obj: Record<string, unknown>, source: RunEventSource): string {
    if (source === 'claude-pty') return extractClaudePtyPreview(obj);
    if (source === 'copilot') return extractCopilotPreview(obj);
    return extractStreamJsonPreview(obj);
}

// Color-code event headers so the Owner can scan the stream and spot
// what's worth expanding. Mercury palette: status colors for result/error,
// muted neutrals for everything else.
function eventColor(header: string): string {
    if (header.startsWith('assistant')) return ATLAS_PALETTE.slate60;
    if (header.startsWith('user')) return ATLAS_PALETTE.slate;
    if (header.startsWith('result')) return ATLAS_PALETTE.success;
    if (header.startsWith('session')) return ATLAS_PALETTE.slate40;
    if (header.includes('error') || header.includes('hook_response')) return ATLAS_PALETTE.error;
    return ATLAS_PALETTE.slate60;
}

// Hard cap on how many lines the parser + renderer will materialize from a
// single NDJSON blob. Long agent runs (hours of terminal transcript) can
// hit multi-MB of content; without this cap the browser tab OOMs on the
// initial page-open when every line is JSON.parse'd, kept in memory as
// raw+obj+preview strings, AND rendered into the DOM. The tail — closest
// to "now" — is kept because it's what the Owner cares about. If the cap
// is hit, the caller can surface a banner via the returned metadata.
const RUN_EVENT_LINE_CAP = 5_000;

interface ParsedEvents {
    events: RunEvent[];
    /** True if the source content had more lines than the cap and the
     *  older prefix was dropped from the returned slice. */
    truncated: boolean;
    /** Total non-empty lines observed in the source (pre-truncation). */
    totalLines: number;
}

function parseEvents(content: string | null, source: RunEventSource): ParsedEvents {
    if (!content) return { events: [], truncated: false, totalLines: 0 };
    // Tail-slice at the character level FIRST — parsing 100 MB of NDJSON
    // just to drop the head is what we're trying to avoid. Look for the
    // Nth-from-last newline and start there. Approximate; a slight
    // overshoot is fine, the cap on `out.push` below is exact.
    const rawLines = content.split(/\r?\n/);
    const totalLines = rawLines.filter((l) => l.trim().length > 0).length;
    const truncated = rawLines.length > RUN_EVENT_LINE_CAP;
    const slice = truncated ? rawLines.slice(-RUN_EVENT_LINE_CAP) : rawLines;
    const out: RunEvent[] = [];
    for (const rawLine of slice) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;
        if (line.trimStart().startsWith('{')) {
            try {
                const obj = JSON.parse(line.trim()) as Record<string, unknown>;
                const type = typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
                const subtype = typeof obj['subtype'] === 'string' ? (obj['subtype'] as string) : '';
                const header = subtype ? `${type}/${subtype}` : type || 'event';
                const hasApiError = ATLAS_API_ERROR_RE.test(line);
                out.push({
                    kind: 'json',
                    raw: line,
                    obj,
                    header,
                    preview: extractPreview(obj, source),
                    hasApiError,
                });
                continue;
            } catch {
                /* fall through to text */
            }
        }
        out.push({
            kind: 'text',
            text: line,
            tone: line.startsWith('[stderr]') ? 'stderr' : 'normal',
        });
    }
    return { events: out, truncated, totalLines };
}

export interface RunEventViewerProps {
    /** Raw NDJSON content. Pass null/empty to show the empty placeholder. */
    content: string | null;
    /** Selects the per-event preview extractor. */
    source: RunEventSource;
    /**
     * When this changes, selection resets to event #0 AND viewMode resets to
     * the source-appropriate default. AgentRunDetail passes the runId so
     * navigating from run A to run B doesn't carry A's selection over;
     * TerminalHistory passes the session id for the same reason.
     */
    resetKey?: string;
    /** Override the empty-content placeholder text. */
    emptyPlaceholder?: string;
}

export function RunEventViewer({
    content,
    source,
    resetKey,
    emptyPlaceholder = '— no output captured —',
}: RunEventViewerProps) {
    // viewMode: copilot defaults to Raw text (its output is largely plain
    // text with a stderr trailer); claude (stream-json and PTY) defaults to
    // Timeline since its NDJSON cards are the primary signal.
    const [viewMode, setViewMode] = useState<'timeline' | 'text'>(() =>
        source === 'copilot' ? 'text' : 'timeline',
    );
    useEffect(() => {
        setViewMode(source === 'copilot' ? 'text' : 'timeline');
    }, [source, resetKey]);

    // `eventsTruncated` and `eventsTotalLines` reflect the RUN_EVENT_LINE_CAP
    // guard in parseEvents. Retained on the destructure so downstream UI can
    // render a "showing last N of M lines" banner in a follow-up without
    // another useMemo pass. Prefixed with _ to satisfy no-unused-vars while
    // the banner ships separately.
    const { events, truncated: _eventsTruncated, totalLines: _eventsTotalLines } = useMemo(
        () => parseEvents(content, source),
        [content, source],
    );

    // Right pane is single-event: the section index drives which event is
    // shown so the Owner reads one card at a time. Default to event #0;
    // reset whenever resetKey flips (run id / session id changed).
    const [selectedIdx, setSelectedIdx] = useState(0);
    useEffect(() => {
        setSelectedIdx(0);
    }, [resetKey]);

    // Clamp the selection so a long run that's still streaming doesn't keep
    // a stale higher index, and a run with no events at all renders the
    // placeholder cleanly.
    const safeSelectedIdx = events.length === 0 ? 0 : Math.min(selectedIdx, events.length - 1);
    const selectedEvent = events[safeSelectedIdx];

    // Auto-scroll the section index to keep the selected row in view.
    const indexRef = useRef<HTMLDivElement | null>(null);
    const selectedRowRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        const row = selectedRowRef.current;
        const container = indexRef.current;
        if (!row || !container) return;
        const rowTop = row.offsetTop - container.offsetTop;
        const rowBottom = rowTop + row.offsetHeight;
        if (rowTop < container.scrollTop) {
            container.scrollTo({ top: rowTop - 8, behavior: 'smooth' });
        } else if (rowBottom > container.scrollTop + container.clientHeight) {
            container.scrollTo({
                top: rowBottom - container.clientHeight + 8,
                behavior: 'smooth',
            });
        }
    }, [safeSelectedIdx]);

    return (
        <>
            <Tabs
                value={viewMode}
                onChange={(_, v) => setViewMode(v as 'timeline' | 'text')}
                sx={{
                    mb: 1.5,
                    borderBottom: 1,
                    borderColor: ATLAS_PALETTE.slate12,
                    minHeight: 36,
                    '& .MuiTab-root': {
                        color: ATLAS_PALETTE.slate40,
                        textTransform: 'none',
                        fontSize: 13,
                        minHeight: 36,
                        py: 0.5,
                    },
                    '& .Mui-selected': { color: ATLAS_PALETTE.cerulean },
                    '& .MuiTabs-indicator': { backgroundColor: ATLAS_PALETTE.cerulean },
                }}
            >
                <Tab label="Timeline" value="timeline" />
                <Tab label="Raw text" value="text" />
            </Tabs>
            {viewMode === 'timeline' && (
                <Box
                    sx={{
                        display: 'grid',
                        gap: 1.5,
                        gridTemplateColumns: { xs: '1fr', md: '260px 1fr' },
                        gridTemplateRows: { xs: 'auto auto', md: 'auto' },
                        height: { md: '80vh' },
                        minHeight: { md: 480 },
                    }}
                >
                    <Box
                        ref={indexRef}
                        sx={{
                            background: ATLAS_PALETTE.surfaceRaised,
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate12}`,
                            overflow: 'auto',
                            p: 0.5,
                            maxHeight: { xs: 200, md: 'none' },
                            height: { md: '100%' },
                        }}
                    >
                        {events.length > 0 ? (
                            events.map((ev, idx) => {
                                const isText = ev.kind === 'text';
                                const headerLabel = isText
                                    ? ev.tone === 'stderr'
                                        ? 'stderr'
                                        : 'text'
                                    : ev.header;
                                const apiErrorOverride =
                                    !isText && ev.hasApiError ? ATLAS_PALETTE.error : null;
                                const headerColor =
                                    apiErrorOverride ??
                                    (isText
                                        ? ev.tone === 'stderr'
                                            ? ATLAS_PALETTE.error
                                            : ATLAS_PALETTE.slate60
                                        : eventColor(ev.header));
                                const preview = isText ? ev.text : ev.preview;
                                const isSelected = idx === safeSelectedIdx;
                                return (
                                    <Box
                                        key={idx}
                                        ref={isSelected ? selectedRowRef : undefined}
                                        component="button"
                                        type="button"
                                        onClick={() => setSelectedIdx(idx)}
                                        sx={{
                                            all: 'unset',
                                            display: 'block',
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            cursor: 'pointer',
                                            px: 1,
                                            py: 0.5,
                                            borderRadius: '4px',
                                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                                            fontSize: 11.5,
                                            background: isSelected
                                                ? ATLAS_PALETTE.slate12
                                                : 'transparent',
                                            boxShadow: isSelected
                                                ? `inset 2px 0 0 ${headerColor}`
                                                : 'none',
                                            '&:hover': {
                                                background: isSelected
                                                    ? ATLAS_PALETTE.slate12
                                                    : ATLAS_PALETTE.slate08,
                                            },
                                            '&:focus-visible': {
                                                background: ATLAS_PALETTE.slate12,
                                                outline: `1px solid ${headerColor}`,
                                            },
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                gap: 0.75,
                                                alignItems: 'baseline',
                                                color: headerColor,
                                                fontWeight: 600,
                                            }}
                                        >
                                            <Box
                                                component="span"
                                                sx={{
                                                    color: ATLAS_PALETTE.slate40,
                                                    fontWeight: 400,
                                                    minWidth: 22,
                                                    textAlign: 'right',
                                                    fontSize: 10.5,
                                                }}
                                            >
                                                {idx + 1}
                                            </Box>
                                            <Box
                                                component="span"
                                                sx={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    flex: 1,
                                                    minWidth: 0,
                                                }}
                                            >
                                                {headerLabel}
                                            </Box>
                                        </Box>
                                        {preview && (
                                            <Box
                                                sx={{
                                                    pl: '30px',
                                                    color: ATLAS_PALETTE.slate60,
                                                    fontSize: 10.5,
                                                    lineHeight: 1.4,
                                                    mt: 0.25,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {preview}
                                            </Box>
                                        )}
                                    </Box>
                                );
                            })
                        ) : (
                            <Box
                                sx={{
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    fontSize: 11.5,
                                    color: ATLAS_PALETTE.slate40,
                                    px: 1,
                                    py: 0.75,
                                }}
                            >
                                no events yet
                            </Box>
                        )}
                    </Box>

                    <Box
                        sx={{
                            background: ATLAS_PALETTE.surfaceRaised,
                            borderRadius: '10px',
                            p: 2,
                            m: 0,
                            overflow: 'auto',
                            maxHeight: { xs: 380, md: 'none' },
                            height: { md: '100%' },
                            border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        }}
                    >
                        {selectedEvent ? (
                            selectedEvent.kind === 'text' ? (
                                <Box>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: 1,
                                            mb: 1,
                                            pb: 1,
                                            borderBottom: `1px solid ${ATLAS_PALETTE.slate12}`,
                                        }}
                                    >
                                        <Box
                                            component="span"
                                            sx={{
                                                color: ATLAS_PALETTE.slate40,
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                fontSize: 11,
                                            }}
                                        >
                                            #{safeSelectedIdx + 1}
                                        </Box>
                                        <Box
                                            component="span"
                                            sx={{
                                                color:
                                                    selectedEvent.tone === 'stderr'
                                                        ? ATLAS_PALETTE.error
                                                        : ATLAS_PALETTE.slate60,
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                fontSize: 11.5,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {selectedEvent.tone === 'stderr' ? 'stderr' : 'text'}
                                        </Box>
                                    </Box>
                                    <Box
                                        component="pre"
                                        sx={{
                                            m: 0,
                                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                                            fontSize: 12,
                                            lineHeight: 1.6,
                                            color:
                                                selectedEvent.tone === 'stderr'
                                                    ? ATLAS_PALETTE.error
                                                    : ATLAS_PALETTE.slate,
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {selectedEvent.text}
                                    </Box>
                                </Box>
                            ) : (
                                <Box>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: 1,
                                            mb: 1,
                                            pb: 1,
                                            borderBottom: `1px solid ${ATLAS_PALETTE.slate12}`,
                                        }}
                                    >
                                        <Box
                                            component="span"
                                            sx={{
                                                color: ATLAS_PALETTE.slate40,
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                fontSize: 11,
                                            }}
                                        >
                                            #{safeSelectedIdx + 1}
                                        </Box>
                                        <Box
                                            component="span"
                                            sx={{
                                                color: eventColor(selectedEvent.header),
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                fontSize: 12,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {selectedEvent.header}
                                        </Box>
                                    </Box>
                                    <Box
                                        component="pre"
                                        sx={{
                                            background: ATLAS_PALETTE.pageBg,
                                            m: 0,
                                            p: 1.5,
                                            borderRadius: '6px',
                                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                                            fontSize: 12,
                                            lineHeight: 1.55,
                                            color: ATLAS_PALETTE.slate,
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {JSON.stringify(selectedEvent.obj, null, 2)}
                                    </Box>
                                </Box>
                            )
                        ) : (
                            <Box
                                sx={{
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.slate40,
                                }}
                            >
                                {emptyPlaceholder}
                            </Box>
                        )}
                    </Box>
                </Box>
            )}
            {viewMode === 'text' && (
                <Box
                    component="pre"
                    sx={{
                        background: ATLAS_PALETTE.pageBg,
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '10px',
                        m: 0,
                        p: 1.5,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: ATLAS_PALETTE.slate,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        height: { md: '80vh' },
                        minHeight: { md: 480 },
                        maxHeight: { xs: '70vh', md: '80vh' },
                        overflow: 'auto',
                    }}
                >
                    {content && content.length > 0 ? content : emptyPlaceholder}
                </Box>
            )}
        </>
    );
}
