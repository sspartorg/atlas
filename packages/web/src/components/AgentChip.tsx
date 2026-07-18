import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { InitialAvatar } from './InitialAvatar.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    agent: Pick<IAgent, 'name' | 'accent_color'> & { designation?: string };
    size?: 'xs' | 'sm' | 'md';
    showName?: boolean;
    /**
     * `'inline'` (default): name + designation on one line, dot-separated.
     * Right for inline prose contexts and mobile lists.
     *
     * `'stacked'`: name on the first line, designation below in smaller
     * muted text. Use on desktop tables (`WorkItemTable`, `EpicTable`) and
     * detail rails (`DetailsRailCard`) where the row has vertical room.
     * Falls back to a single name line when designation is empty (Owner
     * fallback chips, agents with no designation).
     */
    layout?: 'inline' | 'stacked';
}

export function AgentChip({ agent, size = 'md', showName = true, layout = 'inline' }: Props) {
    const avatarSize = size === 'xs' ? 16 : size === 'sm' ? 20 : 24;
    const avatarFontSize = size === 'xs' ? 9 : size === 'sm' ? 11 : 12;
    const nameFontSize = size === 'xs' ? 11 : size === 'sm' ? 12 : 13;
    const designationFontSize = size === 'xs' ? 9 : size === 'sm' ? 10 : 11;
    // `stack` controls the layout switch only — it doesn't gate on the
    // presence of a designation. Tables and detail rails pass
    // layout="stacked" for human owners too (who have no designation),
    // and the old `&& Boolean(agent.designation)` was falling back to the
    // inline path. That inline path colours the name with the user's
    // `accent_color`, which is `#2E2E2E` by default — invisible on the
    // dark-mode page background. Keep the stacked container and just omit
    // the designation row when it's empty.
    const stack = layout === 'stacked';
    const inlineLabel = agent.designation ? `${agent.name} · ${agent.designation}` : agent.name;

    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                // `flexShrink: 0` was preventing the chip from narrowing in
                // constrained parents (kanban cards), which kept the inner
                // Typography from ever triggering its ellipsis. `1` lets a
                // flex parent shrink the chip down to the avatar + ellipsis
                // when the column is narrow; `maxWidth: 100%` is the
                // fallback in non-flex parents (block containers).
                flexShrink: 1,
                minWidth: 0,
                maxWidth: '100%',
            }}
        >
            <InitialAvatar
                name={agent.name}
                color={agent.accent_color}
                size={avatarSize}
                fontSize={avatarFontSize}
            />
            {showName && stack ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: nameFontSize,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: '"Inter", system-ui, sans-serif',
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {agent.name}
                    </Typography>
                    {agent.designation && (
                        <Typography
                            sx={{
                                fontSize: designationFontSize,
                                color: ATLAS_PALETTE.slate60,
                                fontFamily: '"Inter", system-ui, sans-serif',
                                lineHeight: 1.2,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {agent.designation}
                        </Typography>
                    )}
                </Box>
            ) : showName ? (
                <Typography
                    sx={{
                        fontSize: nameFontSize,
                        fontWeight: 500,
                        // Name uses the theme-aware `slate` rather than the
                        // per-agent `accent_color`. The colored avatar already
                        // carries the agent's identity; the name needs to be
                        // readable on every surface in both modes (the human
                        // owner's default accent `#2E2E2E` was painting the
                        // name invisible on dark kanban cards).
                        color: ATLAS_PALETTE.slate,
                        fontFamily: '"Inter", system-ui, sans-serif',
                        lineHeight: 1,
                        // Truncate long labels like "PO Reviewer · Product
                        // Owner – Reviewer" so they don't overflow narrow
                        // kanban cards. Same pattern the stacked layout uses
                        // above. `minWidth: 0` is already on the parent at
                        // L47 so the ellipsis engages in flex/grid parents.
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                    }}
                    title={inlineLabel}
                >
                    {inlineLabel}
                </Typography>
            ) : null}
        </Box>
    );
}
