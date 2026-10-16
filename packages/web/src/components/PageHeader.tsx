import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb.js';
import { PageTitleIcon } from './PageTitleIcon.js';

/** The page title's type — shared with detail pages that lay out their own header. */
export const PAGE_TITLE_SX = {
    fontSize: { xs: '1.75rem', md: '2.25rem' },
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    color: ATLAS_PALETTE.slate,
} as const;

/** The line under a page title. */
const PAGE_SUBTITLE_SX = {
    mt: 1.5,
    fontSize: 13,
    lineHeight: 1.5,
    color: ATLAS_PALETTE.slate60,
} as const;

interface PageHeaderProps {
    /** The page's sidenav glyph (Material Symbols name). */
    icon?: string;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Only on pages with a parent (sub-pages, detail pages). */
    breadcrumbs?: BreadcrumbItem[];
    /** Buttons and toggles, right-aligned on the title's line. */
    actions?: ReactNode;
    /** Phones get these actions elsewhere (a FAB, the mobile app bar). */
    hideActionsOnMobile?: boolean;
}

/**
 * The top of every list and settings page: breadcrumb (when the page has a
 * parent), icon + title, one subtitle line, actions on the right. One size,
 * one spacing, everywhere — pages used to each roll their own (four title
 * sizes, five breadcrumb styles).
 */
export function PageHeader({
    icon,
    title,
    subtitle,
    breadcrumbs,
    actions,
    hideActionsOnMobile = false,
}: PageHeaderProps) {
    return (
        <Box component="header" sx={{ mb: 6 }}>
            {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} />}
            {/* Desktop: a grid — title over subtitle on the left, the actions spanning
                both on the right. Phones: title + actions are one row (the title wraps
                between words beside them; the actions only drop when they can't fit next
                to the title's longest word) and the subtitle runs full width below. The
                title and subtitle used to share one box, so a long subtitle widened it
                and pushed the actions under the subtitle. */}
            <Box
                sx={{
                    display: { xs: 'block', md: 'grid' },
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gridTemplateAreas: '"title actions" "subtitle actions"',
                    columnGap: 4,
                }}
            >
                <Box
                    data-testid="page-header-title-row"
                    sx={{
                        // `contents` on desktop: title and actions become the grid's items.
                        display: { xs: 'flex', md: 'contents' },
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        columnGap: 2,
                        rowGap: 2,
                    }}
                >
                    <Typography
                        variant="h1"
                        sx={{
                            ...PAGE_TITLE_SX,
                            gridArea: 'title',
                            // Basis 0 + the flex item's min-content floor: it gives up
                            // width to the actions down to its longest word, then wraps.
                            // The heavy grow weight keeps the free space on its side while
                            // the actions share its line.
                            flex: '999 1 0',
                        }}
                    >
                        {icon && <PageTitleIcon name={icon} />}
                        {title}
                    </Typography>
                    {actions && (
                        <Box
                            data-testid="page-header-actions"
                            sx={{
                                gridArea: 'actions',
                                display: hideActionsOnMobile ? { xs: 'none', md: 'flex' } : 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                flexWrap: { xs: 'nowrap', md: 'wrap' },
                                gap: { xs: 1, md: 2 },
                                ml: 'auto',
                                // Dropped onto a line of their own, the actions fill it,
                                // so a segmented control can stretch full width.
                                flex: { xs: '1 0 auto', md: 'none' },
                                alignSelf: { md: 'start' },
                                // Desktop: centred on the title's line, not the whole block.
                                minHeight: { md: 43 },
                            }}
                        >
                            {actions}
                        </Box>
                    )}
                </Box>
                {subtitle && (
                    <Typography component="div" sx={{ ...PAGE_SUBTITLE_SX, gridArea: 'subtitle' }}>
                        {subtitle}
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
