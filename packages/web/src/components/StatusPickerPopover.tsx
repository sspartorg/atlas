import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CheckRounded from '@mui/icons-material/CheckRounded';
import {
    ISSUE_STATUSES,
    STATUS_LABELS,
    getValidNextStatuses,
    type IssueStatus,
    type IssueType,
} from '@atlas/shared';
import { ATLAS_PALETTE, STATUS_PALETTE } from '../theme/tokens.js';

interface Props {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    issueType: IssueType;
    current: IssueStatus;
    /** Called with override=false for valid forward/escape transitions and
     *  override=true for the Override section (any status). */
    onPick: (next: IssueStatus, override: boolean) => void;
}

function StatusDot({ status }: { status: IssueStatus }) {
    const cfg = STATUS_PALETTE[status];
    // Use the mid-tone `.dot` colour. The earlier pastel-bg + tonal-fg
    // border combo read as washy at this size — a single recognisable
    // hue reads cleanly on both light and dark dropdown surfaces.
    return (
        <Box
            sx={{
                width: 10,
                height: 10,
                borderRadius: '9999px',
                background: cfg?.dot ?? ATLAS_PALETTE.slate40,
                flexShrink: 0,
            }}
        />
    );
}

function StatusRow({
    status,
    isCurrent,
    onClick,
}: {
    status: IssueStatus;
    isCurrent: boolean;
    onClick: () => void;
}) {
    return (
        <MenuItem
            onClick={onClick}
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                fontSize: 13,
                color: ATLAS_PALETTE.slate,
            }}
        >
            <StatusDot status={status} />
            <Box sx={{ flex: 1 }}>{STATUS_LABELS[status]}</Box>
            {isCurrent && <CheckRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }} />}
        </MenuItem>
    );
}

export function StatusPickerPopover({
    anchorEl,
    open,
    onClose,
    issueType,
    current,
    onPick,
}: Props) {
    const validNext =
        issueType === 'sub_task'
            ? getValidNextStatuses('sub_task', current)
            : getValidNextStatuses(issueType, current);
    const overrideOnly = ISSUE_STATUSES.filter(
        (s) => s !== current && !validNext.includes(s)
    ) as IssueStatus[];

    return (
        <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
                paper: {
                    sx: {
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '10px',
                        boxShadow: '0 12px 32px rgba(0,0,14,.12)',
                        minWidth: 240,
                        mt: 1,
                    },
                },
            }}
        >
            <Typography
                sx={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    px: 2,
                    py: 1,
                }}
            >
                Move to
            </Typography>
            <StatusRow status={current} isCurrent onClick={onClose} />
            {validNext.map((s) => (
                <StatusRow
                    key={s}
                    status={s}
                    isCurrent={false}
                    onClick={() => {
                        onPick(s, false);
                        onClose();
                    }}
                />
            ))}

            {overrideOnly.length > 0 && <Divider sx={{ my: 0.5 }} />}
            {overrideOnly.length > 0 && (
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        px: 2,
                        py: 1,
                    }}
                >
                    Override
                </Typography>
            )}
            {overrideOnly.map((s) => (
                <StatusRow
                    key={s}
                    status={s}
                    isCurrent={false}
                    onClick={() => {
                        onPick(s, true);
                        onClose();
                    }}
                />
            ))}
        </Menu>
    );
}
