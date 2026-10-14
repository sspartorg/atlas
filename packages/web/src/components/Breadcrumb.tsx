import { Fragment, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';

export interface BreadcrumbItem {
    label: string;
    to?: string | undefined;
    /** Small glyph before the label (e.g. the item kind on a task page). */
    icon?: ReactNode;
    /** Monospace label, for IDs. */
    mono?: boolean | undefined;
}

interface Props {
    items: BreadcrumbItem[];
    /** Trailing control on the breadcrumb line (e.g. copy link). */
    after?: ReactNode;
}

/**
 * The one breadcrumb style: "Parent › Page", 13 px, above a page's title.
 * Only pages with a parent show one (a sub-page or a detail page); top-level
 * pages don't — the sidenav already says where you are. Earlier items are
 * real links (keyboard reachable); the last is the current page.
 */
export function Breadcrumb({ items, after }: Props) {
    return (
        <Box
            component="nav"
            aria-label="Breadcrumb"
            sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}
        >
            {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                const font = item.mono ? TYPOGRAPHY.fontFamilyMono : undefined;
                return (
                    <Fragment key={`${item.label}-${idx}`}>
                        {item.icon && (
                            <Box component="span" sx={{ display: 'inline-flex', mr: -0.5 }}>
                                {item.icon}
                            </Box>
                        )}
                        {item.to && !isLast ? (
                            <Link
                                component={RouterLink}
                                to={item.to}
                                underline="hover"
                                sx={{
                                    fontSize: 13,
                                    fontFamily: font,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                {item.label}
                            </Link>
                        ) : (
                            <Typography
                                component="span"
                                aria-current={isLast ? 'page' : undefined}
                                sx={{
                                    fontSize: 13,
                                    fontFamily: font,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                {item.label}
                            </Typography>
                        )}
                        {!isLast && (
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 14, color: ATLAS_PALETTE.slate30 }}
                            >
                                chevron_right
                            </Box>
                        )}
                    </Fragment>
                );
            })}
            {after}
        </Box>
    );
}
