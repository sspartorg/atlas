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
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 4,
                    flexWrap: 'wrap',
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h1" sx={PAGE_TITLE_SX}>
                        {icon && <PageTitleIcon name={icon} />}
                        {title}
                    </Typography>
                    {subtitle && (
                        <Typography component="div" sx={PAGE_SUBTITLE_SX}>
                            {subtitle}
                        </Typography>
                    )}
                </Box>
                {actions && (
                    <Box
                        sx={{
                            display: hideActionsOnMobile ? { xs: 'none', md: 'flex' } : 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 2,
                            // Centred on the title's line, not the whole block.
                            minHeight: { xs: 34, md: 43 },
                        }}
                    >
                        {actions}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
