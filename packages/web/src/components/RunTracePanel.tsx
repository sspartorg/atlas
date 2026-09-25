import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { IRunTraceSummary } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';

// What the agent DID, beside what it said it did.
//
// Every dispatch has always written its full transcript to
// `agent_runs.output_text`, and the only thing anyone could read off a run was
// the `atlas-outcome` block the agent wrote about itself. Migration 017 parses
// that transcript once at completion; this renders it.
//
// The rule the whole panel turns on: a field a CLI cannot report is `null`,
// never `0`. Copilot does not emit thinking blocks or tool arguments, so
// "files touched" on a Copilot run is unknown — and showing "0 files" would be
// a claim nobody made.

/** How many tools get their own row before the rest collapse into one. */
const TOOL_ROWS = 6;
/** Paths listed before the remainder is summarised. */
const FILE_ROWS = 8;

function duration(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    const body = (
        <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 600, color: ATLAS_PALETTE.slate, lineHeight: 1.2 }}>
                {value}
            </Typography>
            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {label}
            </Typography>
        </Box>
    );
    return hint ? (
        <Tooltip title={hint}>
            <Box>{body}</Box>
        </Tooltip>
    ) : (
        body
    );
}

export function RunTracePanel({ trace }: { trace: IRunTraceSummary | null }) {
    // A run that finished before migration 017, or whose output was never a
    // transcript. Rendering an empty panel would read as "it did nothing".
    if (!trace) return null;

    const tools = Object.entries(trace.tools).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const busiest = tools[0]?.[1] ?? 1;
    const shown = tools.slice(0, TOOL_ROWS);
    const rest = tools.slice(TOOL_ROWS);
    const files = trace.files_touched ?? [];
    /** Copilot reports tool names but not their arguments. */
    const unknown: string[] = [];
    if (trace.files_touched === null) unknown.push('files touched');
    if (trace.thinking_blocks === null) unknown.push('thinking');

    return (
        <Box
            sx={{
                p: 2.5,
                mb: 3,
                borderRadius: '8px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.white,
            }}
        >
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 2 }}>
                How it worked
            </Typography>

            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', mb: tools.length > 0 ? 2.5 : 0 }}>
                <Stat label="turns" value={String(trace.turns)} />
                <Stat label="tool calls" value={String(trace.tool_calls)} />
                {trace.thinking_blocks !== null && (
                    <Stat label="thinking" value={String(trace.thinking_blocks)} />
                )}
                {trace.subagent_turns !== null && trace.subagent_turns > 0 && (
                    <Stat
                        label="sub-agent"
                        value={String(trace.subagent_turns)}
                        hint="Turns produced by a sub-agent this run spawned"
                    />
                )}
                {trace.ttft_ms !== null && (
                    <Stat
                        label="first token"
                        value={duration(trace.ttft_ms)}
                        hint="From the run starting to the agent's first word"
                    />
                )}
                {trace.errors !== null && trace.errors > 0 && (
                    <Stat label="tool errors" value={String(trace.errors)} />
                )}
            </Box>

            {shown.length > 0 && (
                <Box sx={{ display: 'grid', gap: 0.75, mb: files.length > 0 ? 2.5 : 0 }}>
                    {shown.map(([name, count]) => (
                        <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography
                                sx={{
                                    fontSize: 12,
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    color: ATLAS_PALETTE.slate,
                                    minWidth: 160,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {name}
                            </Typography>
                            <Box
                                aria-hidden="true"
                                sx={{
                                    height: 6,
                                    borderRadius: '3px',
                                    background: ATLAS_PALETTE.brandBlue,
                                    width: `${Math.max(4, (count / busiest) * 100)}%`,
                                    maxWidth: 320,
                                }}
                            />
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{count}</Typography>
                        </Box>
                    ))}
                    {rest.length > 0 && (
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            + {rest.length} more {rest.length === 1 ? 'tool' : 'tools'},{' '}
                            {rest.reduce((n, [, c]) => n + c, 0)} calls
                        </Typography>
                    )}
                </Box>
            )}

            {files.length > 0 && (
                <Box>
                    <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, textTransform: 'uppercase', letterSpacing: '.04em', mb: 0.75 }}>
                        Files touched
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                        {files.slice(0, FILE_ROWS).map((f) => (
                            <Typography
                                key={f}
                                sx={{
                                    fontSize: 11,
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    color: ATLAS_PALETTE.slate60,
                                    background: ATLAS_PALETTE.slate06,
                                    borderRadius: '4px',
                                    px: 0.75,
                                    py: 0.25,
                                }}
                            >
                                {f}
                            </Typography>
                        ))}
                        {files.length > FILE_ROWS && (
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, alignSelf: 'center' }}>
                                + {files.length - FILE_ROWS} more
                            </Typography>
                        )}
                    </Box>
                </Box>
            )}

            {(unknown.length > 0 || trace.truncated) && (
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                    {unknown.length > 0 && `This CLI does not report ${unknown.join(' or ')}. `}
                    {trace.truncated && 'A long run: the list above is the first part of it.'}
                </Typography>
            )}
        </Box>
    );
}
