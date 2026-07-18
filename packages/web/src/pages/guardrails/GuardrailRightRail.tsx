import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { GUARDRAIL_SEVERITIES, GUARDRAIL_SEVERITY_META } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { GuardrailSeverityChip } from './GuardrailSeverityChip.js';

const MONO = '"JetBrains Mono", monospace';

export function GuardrailRightRail() {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <RailCard title="How rules apply">
                <Typography
                    sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mb: 2, lineHeight: 1.55 }}
                >
                    Each rule is merged into the agent prompt as a numbered checklist. Agents must
                    check off violations before producing output.
                </Typography>
                {/* Always-dark "terminal" code block — both light and dark
                    themes show the same fixed dark surface so the example
                    reads as a markdown/config snippet, not as theme chrome.
                    The previous `ATLAS_PALETTE.slate` bg flipped to near-
                    white in dark mode, making the bright `#A3F7BF` green
                    text unreadable. Now: dark slate bg, muted gray body,
                    accent green ONLY on the `[BLOCK]` severity token. */}
                <Box
                    sx={{
                        bgcolor: '#0F172A',
                        color: '#CBD5E1',
                        fontFamily: MONO,
                        fontSize: 10.5,
                        lineHeight: 1.65,
                        p: 2,
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,.06)',
                        whiteSpace: 'pre-wrap',
                        '& .c-comment': { color: '#64748B' },
                        '& .c-heading': { color: '#E2E8F0', fontWeight: 600 },
                        '& .c-block': { color: '#FCA5A5', fontWeight: 600 },
                        '& .c-code': { color: '#FCD34D' },
                    }}
                >
                    <span className="c-comment">{`# Atlas Constitution\n…\n`}</span>
                    <span className="c-heading">{`## Git & Branches\n`}</span>
                    {`- `}
                    <span className="c-block">{`[BLOCK]`}</span>
                    {` Never run `}
                    <span className="c-code">{`\`git\n  push --force\``}</span>
                    {`.\n\nAgent output is then\nchecked against these\nbefore the run finishes.`}
                </Box>
            </RailCard>

            <RailCard title="Severity">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {GUARDRAIL_SEVERITIES.map((sev) => (
                        <Box
                            key={sev}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr',
                                gap: 1.5,
                                alignItems: 'center',
                            }}
                        >
                            <GuardrailSeverityChip severity={sev} />
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    lineHeight: 1.5,
                                }}
                            >
                                {GUARDRAIL_SEVERITY_META[sev].description}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </RailCard>

            <RailCard title="Scope">
                <Row label="Agents" value="All agents" />
                <Row label="Projects" value="All projects" />
            </RailCard>
        </Box>
    );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box
            sx={{
                bgcolor: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '10px',
                p: 3,
            }}
        >
            <Typography
                sx={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    mb: 2,
                }}
            >
                {title}
            </Typography>
            {children}
        </Box>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: '88px 1fr',
                alignItems: 'baseline',
                columnGap: 1.5,
                mb: 0.75,
            }}
        >
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {label}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 12, color: ATLAS_PALETTE.slate }}>
                {value}
            </Typography>
        </Box>
    );
}
