import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, MOBILE_SHELL } from '../../theme/tokens.js';
import { usePageTitle } from './PageTitleContext.js';
import { HeaderMascot } from '../HeaderMascot.js';

export function MobileAppBar() {
    const page = usePageTitle();
    const title = page?.title ?? 'Atlas';

    return (
        <Box
            component="header"
            sx={{
                flexShrink: 0,
                background: ATLAS_PALETTE.white,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                paddingTop: 'env(safe-area-inset-top)',
            }}
        >
            <Box
                sx={{
                    height: MOBILE_SHELL.appBarHeight,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    px: 3,
                }}
            >
                <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <Typography
                        sx={{
                            fontSize: 17,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            lineHeight: 1.2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {title}
                    </Typography>
                    {page?.subtitle && (
                        <Typography
                            component="div"
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate60,
                                lineHeight: 1.2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {page.subtitle}
                        </Typography>
                    )}
                </Box>
                {/* Mascot — same live idle/working signal as the desktop topbar. */}
                <HeaderMascot size={32} />
                {page?.trailing && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {page.trailing}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
