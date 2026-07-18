import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import AddRounded from '@mui/icons-material/AddRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import { useNavigate } from 'react-router-dom';
import type { IIssueLinkRow, IItemExternalLink, IssueType, IAgent } from '@atlas/shared';
import {
    useIssueLinks,
    useDeleteIssueLink,
} from '../hooks/useIssueLinks.js';
import {
    useIssueExternalLinks,
    useDeleteIssueExternalLink,
} from '../hooks/useIssueExternalLinks.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../hooks/useToast.js';
import { WorkItemTable, type WorkItemTableRow } from './WorkItemTable.js';
import { AddPrLinkDialog } from './AddPrLinkDialog.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

import { relativeTime } from '../utils/time.js';

interface Props {
    issueType: IssueType;
    issueId: string;
    /** Pre-loaded links from the parent's /full response. When supplied,
     *  the inner useIssueLinks fetch is skipped. */
    relatedLinks?: IIssueLinkRow[];
    /** Pre-loaded external links from the parent's /full response. When
     *  supplied, the inner useIssueExternalLinks fetch is skipped. */
    externalLinks?: IItemExternalLink[];
    /** Pre-loaded agents from the parent's /full response. */
    agents?: IAgent[];
    /**
     * Open the (parent-owned) LinkPickerDialog with the given relation
     * mode. Lifted to the parent so the same dialog instance serves both
     * the in-table add buttons here AND the `+` menu options up in the
     * issue title's add-menu row. The parent mounts `<LinkPickerDialog>`
     * once and toggles its visibility via state.
     */
    onOpenPicker: (mode: 'relates_to' | 'depends_on' | 'tested_by') => void;
    /**
     * When true, render an "Add test link" affordance on the Tested-by
     * section (header button when populated, inline hint + button when
     * empty). Story / Bug / Sub-Task / Sub-Bug detail pages opt in.
     * Epic detail pages omit this prop — epics aren't sensible `from`
     * sides for a `tested_by` edge.
     */
    allowAddTestLink?: boolean | undefined;
}

function routeFor(type: IssueType, id: string): string {
    if (type === 'epic') return `/epics/${id}`;
    if (type === 'story') return `/issues/stories/${id}`;
    if (type === 'sub_task') return `/issues/sub-tasks/${id}`;
    if (type === 'sub_bug') return `/issues/sub-bugs/${id}`;
    return `/issues/bugs/${id}`;
}

export function RelatedItemsCard({
    issueType,
    issueId,
    relatedLinks: propLinks,
    externalLinks: propExtLinks,
    agents: propAgents,
    onOpenPicker,
    allowAddTestLink,
}: Props) {
    const navigate = useNavigate();
    // Only fetch links/agents when the parent did not pre-supply them.
    const { data: fetchedLinks = [] } = useIssueLinks(issueType, issueId, {
        enabled: !propLinks,
    });
    const { data: fetchedExtLinks = [] } = useIssueExternalLinks(issueType, issueId, {
        enabled: !propExtLinks,
    });
    const { data: fetchedAgents = [] } = useAgents({ enabled: !propAgents });
    const links: IIssueLinkRow[] = propLinks ?? fetchedLinks;
    const extLinks: IItemExternalLink[] = propExtLinks ?? fetchedExtLinks;
    const agents: IAgent[] = propAgents ?? fetchedAgents;

    const deleteLink = useDeleteIssueLink(issueType, issueId);
    const deleteExtLink = useDeleteIssueExternalLink(issueType, issueId);
    const toast = useToast();
    const [addPrOpen, setAddPrOpen] = useState(false);

    const { data: settings } = useSettings();

    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const agentsById = useMemo(
        () => new Map(agents.map((w) => [w.id, w] as const)),
        [agents]
    );

    // Partition into "blocked by" (depends_on, where this item is the
    // dependent), "tested by / tests" (tested_by, dev↔QA twin), and
    // "relates to" (generic). The unlink mutation needs the link.id, so
    // each row keeps a stable key including the relation.
    const dependsLinks = useMemo(
        () => links.filter((l) => l.relation_type === 'depends_on'),
        [links],
    );
    const testedByLinks = useMemo(
        () => links.filter((l) => l.relation_type === 'tested_by'),
        [links],
    );
    const relatesLinks = useMemo(
        () => links.filter((l) => l.relation_type === 'relates_to'),
        [links],
    );

    function toRow(l: (typeof links)[number]): WorkItemTableRow {
        return {
            id: l.item_id,
            kind: l.type,
            shortId: l.short_id,
            title: l.title,
            status: l.status,
            assignee_agent_id: null,
            reporter_agent_id: null,
            updated_at: l.created_at,
        };
    }
    const dependsRows = useMemo(() => dependsLinks.map(toRow), [dependsLinks]);
    const testedByRows = useMemo(() => testedByLinks.map(toRow), [testedByLinks]);
    const relatesRows = useMemo(() => relatesLinks.map(toRow), [relatesLinks]);

    // For tested_by the section title flips on direction: incoming = the
    // QA story tests US (we're the dev story), outgoing = WE test the dev
    // story (we're the QA twin). A single item is typically on one side
    // only; if mixed, fall back to a neutral label.
    const testedByDirections = useMemo(() => {
        const set = new Set(testedByLinks.map((l) => l.direction));
        return set;
    }, [testedByLinks]);
    const testedByTitle =
        testedByDirections.size === 1 && testedByDirections.has('outgoing')
            ? 'Tests'
            : testedByDirections.size === 1 && testedByDirections.has('incoming')
              ? 'Tested by'
              : 'Test coverage';

    // link.id is needed to unlink — map from item_id+relation back to the
    // link record so the same target can have both a relates_to and a
    // depends_on link without colliding.
    const linkIdByKey = useMemo(() => {
        const m = new Map<string, number>();
        for (const l of links) {
            m.set(`${l.relation_type}:${l.type}:${l.item_id}`, l.id);
        }
        return m;
    }, [links]);

    function unlinkRow(relation: 'relates_to' | 'depends_on' | 'tested_by') {
        return (row: WorkItemTableRow) => {
            const linkId = linkIdByKey.get(`${relation}:${row.kind}:${row.id}`);
            // Defensive guard: rows are always derived 1:1 from the same `links`
            // array that populates linkIdByKey (same relation/type/item_id key
            // shape), so a row without a matching entry cannot occur in practice.
            /* v8 ignore next */
            if (linkId == null) return null;
            const handleUnlink = async () => {
                try {
                    await deleteLink.mutateAsync(linkId);
                    toast.show({
                        message:
                            relation === 'depends_on'
                                ? `Removed dependency on ${row.shortId}`
                                : relation === 'tested_by'
                                  ? `Removed test link to ${row.shortId}`
                                  : `Unlinked ${row.shortId}`,
                        detail: row.title,
                    });
                } catch (err) {
                    toast.show({
                        message: 'Unlink failed',
                        detail: (err as Error).message,
                    });
                }
            };
            return (
                <IconButton
                    size="small"
                    aria-label="Unlink"
                    onClick={() => void handleUnlink()}
                    sx={{
                        color: ATLAS_PALETTE.slate40,
                        '&:hover': { color: ATLAS_PALETTE.error },
                    }}
                >
                    <LinkOffRounded sx={{ fontSize: 16 }} />
                </IconButton>
            );
        };
    }

    const addDependencyButton = (
        <Button
            variant="text"
            size="small"
            onClick={() => onOpenPicker('depends_on')}
            startIcon={<AddRounded sx={{ fontSize: 16 }} />}
            sx={{
                height: 26,
                textTransform: 'none',
                fontSize: 12,
                color: ATLAS_PALETTE.orange,
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            Add dependency
        </Button>
    );

    const addRelatedButton = (
        <Button
            variant="text"
            size="small"
            onClick={() => onOpenPicker('relates_to')}
            startIcon={<AddRounded sx={{ fontSize: 16 }} />}
            sx={{
                height: 26,
                textTransform: 'none',
                fontSize: 12,
                color: ATLAS_PALETTE.brandBlue,
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            Link an item
        </Button>
    );

    const addTestLinkButton = (
        <Button
            variant="text"
            size="small"
            onClick={() => onOpenPicker('tested_by')}
            startIcon={<AddRounded sx={{ fontSize: 16 }} />}
            sx={{
                height: 26,
                textTransform: 'none',
                fontSize: 12,
                color: ATLAS_PALETTE.slate,
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            Add test link
        </Button>
    );

    // Tested-by section rendering rules:
    //  - allowAddTestLink + rows  → table with Add button in headerRight.
    //  - allowAddTestLink + empty → minimal empty-state header with the
    //    Add button (no table) so Owner can attach the first one.
    //  - !allowAddTestLink + rows → table (no Add button).
    //  - !allowAddTestLink + empty → render nothing (Epic detail).
    let testedBySection: ReactNode = null;
    if (allowAddTestLink && testedByRows.length === 0) {
        testedBySection = (
            <Box sx={{ pt: 1 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1.5,
                        pb: 0.5,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate60,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                        }}
                    >
                        Tested by
                    </Typography>
                    {addTestLinkButton}
                </Box>
                <Typography
                    sx={{
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                    }}
                >
                    No test links yet.
                </Typography>
            </Box>
        );
    } else if (testedByRows.length > 0) {
        testedBySection = (
            <WorkItemTable
                title={testedByTitle}
                rows={testedByRows}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                formatRelative={relativeTime}
                onRowClick={(row) => navigate(routeFor(row.kind, row.id))}
                headerRight={allowAddTestLink ? addTestLinkButton : undefined}
                rowAction={unlinkRow('tested_by')}
                hideWhenEmpty
            />
        );
    }

    async function handleUnlinkPr(link: IItemExternalLink) {
        try {
            await deleteExtLink.mutateAsync(link.id);
            toast.show({
                message: 'PR link removed',
                detail: link.external_ref ? `#${link.external_ref}` : link.url,
            });
        } catch (err) {
            toast.show({ message: 'Remove failed', detail: (err as Error).message });
        }
    }

    const prSection = (
        <Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    pb: 0.5,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate60,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                    }}
                >
                    Pull Requests
                </Typography>
                <Button
                    variant="text"
                    size="small"
                    onClick={() => setAddPrOpen(true)}
                    startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                    sx={{
                        height: 26,
                        textTransform: 'none',
                        fontSize: 12,
                        color: ATLAS_PALETTE.brandBlue,
                        '&:hover': { background: ATLAS_PALETTE.cloud },
                    }}
                >
                    Add PR link
                </Button>
            </Box>
            {extLinks.length === 0 ? (
                <Typography
                    sx={{
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                    }}
                >
                    No pull requests linked yet.
                </Typography>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {extLinks
                        // Client-side scheme allowlist defence-in-depth:
                        // AddPrLinkDialog rejects non-GitHub-PR URLs at ADD
                        // time, but if the server-side validator is ever
                        // loosened OR a marketplace import writes a row
                        // directly, we don't want an XSS-capable
                        // `javascript:` / `data:` URL to render as an
                        // anchor. Skip anything that isn't `https://`.
                        .filter((l) => typeof l.url === 'string' && /^https:\/\//i.test(l.url))
                        .map((l) => (
                        <Box
                            key={l.id}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                py: 0.5,
                                px: 1,
                                borderRadius: 1,
                                '&:hover': { background: ATLAS_PALETTE.cloud },
                            }}
                        >
                            <Typography
                                component="span"
                                sx={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate60,
                                    minWidth: 48,
                                }}
                            >
                                {l.external_ref ? `#${l.external_ref}` : 'PR'}
                            </Typography>
                            <Box
                                component="a"
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.brandBlue,
                                    textDecoration: 'none',
                                    '&:hover': { textDecoration: 'underline' },
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <Box
                                    component="span"
                                    sx={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {l.title ?? l.url}
                                </Box>
                                <OpenInNewRounded sx={{ fontSize: 14, flexShrink: 0 }} />
                            </Box>
                            <IconButton
                                size="small"
                                aria-label="Remove PR link"
                                onClick={() => void handleUnlinkPr(l)}
                                sx={{
                                    color: ATLAS_PALETTE.slate40,
                                    '&:hover': { color: ATLAS_PALETTE.error },
                                }}
                            >
                                <LinkOffRounded sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );

    return (
        <>
            <Box sx={{ mb: 3 }}>{prSection}</Box>

            <WorkItemTable
                title="Blocked by"
                rows={dependsRows}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                formatRelative={relativeTime}
                onRowClick={(row) => navigate(routeFor(row.kind, row.id))}
                headerRight={addDependencyButton}
                rowAction={unlinkRow('depends_on')}
                hideWhenEmpty
            />

            {testedBySection &&
                (dependsRows.length > 0 ? (
                    <Box sx={{ mt: 3 }}>{testedBySection}</Box>
                ) : (
                    testedBySection
                ))}

            {(dependsRows.length > 0 || testedByRows.length > 0) && relatesRows.length > 0 ? (
                <Box sx={{ mt: 3 }}>
                    <WorkItemTable
                        title="Relates to"
                        rows={relatesRows}
                        agentsById={agentsById}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        formatRelative={relativeTime}
                        onRowClick={(row) => navigate(routeFor(row.kind, row.id))}
                        headerRight={addRelatedButton}
                        rowAction={unlinkRow('relates_to')}
                        hideWhenEmpty
                    />
                </Box>
            ) : (
                <WorkItemTable
                    title="Relates to"
                    rows={relatesRows}
                    agentsById={agentsById}
                    ownerName={ownerName}
                    ownerAccent={ownerAccent}
                    formatRelative={relativeTime}
                    onRowClick={(row) => navigate(routeFor(row.kind, row.id))}
                    headerRight={addRelatedButton}
                    rowAction={unlinkRow('relates_to')}
                    hideWhenEmpty
                />
            )}

            <AddPrLinkDialog
                open={addPrOpen}
                onClose={() => setAddPrOpen(false)}
                issueType={issueType}
                issueId={issueId}
            />
        </>
    );
}
