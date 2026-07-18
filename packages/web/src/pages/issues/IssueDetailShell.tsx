import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { CopyLinkButton } from '../../components/CopyLinkButton.js';
import { EditableTitle } from '../../components/EditableTitle.js';
import { KindIcon } from '../../components/KindIcon.js';

export function IssueDetailLoading({ withBreadcrumb = false }: { withBreadcrumb?: boolean }) {
    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {withBreadcrumb && (
                <Skeleton variant="text" width={200} height={20} sx={{ mb: 3 }} />
            )}
            <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '12px', mb: 4 }} />
            <Skeleton variant="rectangular" height={400} sx={{ borderRadius: '12px' }} />
        </Box>
    );
}

const MONO = '"JetBrains Mono", monospace';

interface BreadcrumbStep {
    label: string;
    href?: string | undefined;
    mono?: boolean | undefined;
}

interface Props {
    breadcrumbs: BreadcrumbStep[];
    title: string;
    onTitleSave: (next: string) => Promise<unknown> | unknown;
    titleSaving?: boolean | undefined;
    /** The work-item type. Drives the kind icon shown beside the last
     *  breadcrumb crumb (which holds the item number). */
    issueType: IssueType;
    /** Optional action buttons rendered to the right of the title row.
     *  Most pages leave this empty now that the meta strip is gone. */
    actions?: ReactNode | undefined;
    /** Inline element rendered immediately after the editable title — the
     *  Jira-style `+` menu lives here so callers can pass a type-aware
     *  `<AddRelatedMenu options={…} />` without each page re-implementing
     *  the layout. */
    headerExtras?: ReactNode | undefined;
    rightRail: ReactNode;
    children: ReactNode;
}

export function IssueDetailShell({
    breadcrumbs,
    title,
    onTitleSave,
    titleSaving = false,
    issueType,
    actions,
    headerExtras,
    rightRail,
    children,
}: Props) {
    const navigate = useNavigate();
    const lastIndex = breadcrumbs.length - 1;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Breadcrumb — kind icon + item-number crumb + copy-link button. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                {breadcrumbs.map((step, i) => (
                    <Fragment key={`${step.label}-${i}`}>
                        {i > 0 && (
                            <Box
                                component="span"
                                sx={{ color: ATLAS_PALETTE.slate30, fontSize: 12 }}
                            >
                                /
                            </Box>
                        )}
                        {i === lastIndex && (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', mr: 0.5 }}>
                                <KindIcon kind={issueType} size={14} />
                            </Box>
                        )}
                        <Typography
                            onClick={() => step.href && navigate(step.href)}
                            sx={{
                                fontSize: 12,
                                fontFamily: step.mono ? MONO : undefined,
                                color:
                                    i === lastIndex
                                        ? ATLAS_PALETTE.slate60
                                        : ATLAS_PALETTE.slate40,
                                cursor: step.href ? 'pointer' : 'default',
                                '&:hover': step.href ? { color: ATLAS_PALETTE.slate } : undefined,
                            }}
                        >
                            {step.label}
                        </Typography>
                    </Fragment>
                ))}
                <CopyLinkButton />
            </Box>

            {/* Header row: editable title + optional 3-dots actions menu.
             *  The kind label no longer appears as a text chip — it's the
             *  icon up in the breadcrumb. */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 4,
                    mb: headerExtras ? 3 : 6,
                    flexWrap: 'wrap',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        minWidth: 0,
                        flex: 1,
                    }}
                >
                    <EditableTitle value={title} onSave={onTitleSave} saving={titleSaving} />
                </Box>
                {actions ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        {actions}
                    </Box>
                ) : null}
            </Box>

            {/* `+` add-menu row — sits below the title row so the title +
             *  3-dots actions group reads cleanly on its own line. Only
             *  rendered when the consumer supplies headerExtras. */}
            {headerExtras ? (
                <Box sx={{ mb: 6 }}>{headerExtras}</Box>
            ) : null}

            {/* Body: 2-column grid (rail stacks below content on mobile) */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 360px' },
                    gap: { xs: 4, md: 6 },
                    alignItems: 'flex-start',
                }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</Box>
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        position: 'sticky',
                        top: 24,
                    }}
                >
                    {rightRail}
                </Box>
            </Box>
        </Box>
    );
}

