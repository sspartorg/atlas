import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../theme/tokens.js';

/**
 * The icon in front of a page's title — the same glyph the page has in the
 * sidenav, so a page and its nav entry read as one. Sized in `em` so it
 * matches whatever heading it sits in; place it as the heading's first child.
 *
 *   <Typography variant="h1" …><PageTitleIcon name="flag" />Tasks</Typography>
 */
export function PageTitleIcon({ name }: { name: string }) {
    return (
        <Box
            component="span"
            className="material-symbols-rounded"
            aria-hidden="true"
            sx={{
                fontSize: '1em',
                verticalAlign: '-0.14em',
                mr: '0.25em',
                color: ATLAS_PALETTE.green,
                // The glyph is ligature text: keep it out of a copied title.
                userSelect: 'none',
            }}
        >
            {name}
        </Box>
    );
}
