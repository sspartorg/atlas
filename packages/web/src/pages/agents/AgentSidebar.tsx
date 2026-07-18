import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { InfoPanel, InfoRow } from '../../components/InfoPanel.js';
import { type AgentRuntimeStats, type AgentView } from './agentViewModel.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';

interface Props {
    agent: IAgent;
    view: AgentView;
    stats: AgentRuntimeStats;
    onReplaceGlyph?: () => void;
    onEditColor?: () => void;
}

export const AgentSidebar = memo(function AgentSidebar({
    agent,
    view,
    stats,
    onReplaceGlyph,
    onEditColor,
}: Props) {
    return (
        <Box>
            <InfoPanel label="Identity" mb={2.5}>
                <InfoRow label="Role">
                    <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
                        <Typography
                            title={agent.name}
                            sx={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {agent.name}
                        </Typography>
                        {agent.designation && (
                            <Typography
                                title={agent.designation}
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {agent.designation}
                            </Typography>
                        )}
                    </Box>
                </InfoRow>
                <InfoRow label="Color">
                    <Box
                        onClick={onEditColor}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            cursor: onEditColor ? 'pointer' : 'default',
                            '&:hover .accent-edit-affordance': {
                                color: onEditColor
                                    ? ATLAS_PALETTE.brandBlue
                                    : ATLAS_PALETTE.slate,
                            },
                        }}
                    >
                        <Box
                            sx={{
                                width: 12,
                                height: 12,
                                borderRadius: '3px',
                                background: agent.accent_color,
                                border: `1px solid ${ATLAS_PALETTE.slate12}`,
                            }}
                        />
                        <Typography
                            className="accent-edit-affordance"
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate,
                                transition: 'color 120ms ease',
                            }}
                        >
                            {agent.accent_color.toUpperCase()}
                        </Typography>
                    </Box>
                </InfoRow>
                <InfoRow label="Glyph">
                    <Box
                        onClick={onReplaceGlyph}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            color: ATLAS_PALETTE.brandBlue,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 500,
                            '&:hover .icon-link-text': {
                                textDecoration: 'underline',
                            },
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 14 }}
                        >
                            change_circle
                        </Box>
                        <Box component="span" className="icon-link-text">
                            Replace…
                        </Box>
                    </Box>
                </InfoRow>
            </InfoPanel>

            <InfoPanel label="Schedule" mb={2.5}>
                <InfoRow label="Cadence">
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {view.cadenceLabel}
                    </Typography>
                </InfoRow>
                <InfoRow label="Next pass">
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {view.nextPassLabel}
                    </Typography>
                </InfoRow>
            </InfoPanel>

            <InfoPanel label={`Telemetry · ${new Date().toLocaleString('default', { month: 'short' })}`}>
                <InfoRow label="Total runs">
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {stats.totalRunsThisMonth}
                    </Typography>
                </InfoRow>
                {stats.totalCostThisMonthUsd != null && (
                    <InfoRow label="AI Cost">
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {formatCostUsd(stats.totalCostThisMonthUsd)}
                        </Typography>
                    </InfoRow>
                )}
                {stats.totalInputTokens != null && (
                    <InfoRow label="Input tok.">
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {formatTokenCount(stats.totalInputTokens)}
                        </Typography>
                    </InfoRow>
                )}
                {stats.totalOutputTokens != null && (
                    <InfoRow label="Output tok.">
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {formatTokenCount(stats.totalOutputTokens)}
                        </Typography>
                    </InfoRow>
                )}
                {stats.totalCacheReadTokens != null && (
                    <InfoRow label="Cached tok.">
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {formatTokenCount(stats.totalCacheReadTokens)}
                        </Typography>
                    </InfoRow>
                )}
            </InfoPanel>
        </Box>
    );
});
