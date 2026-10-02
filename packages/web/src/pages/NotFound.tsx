import { Link as RouterLink, useLocation } from 'react-router-dom';
import Button from '@mui/material/Button';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import { HeroEmptyState } from '../components/HeroEmptyState.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// A mistyped or stale link used to land silently on the Dashboard, which read
// as "the page I asked for is the Dashboard".
export function NotFound() {
    const { pathname } = useLocation();
    return (
        <HeroEmptyState
            icon={<SearchOffRounded sx={{ fontSize: 28, color: ATLAS_PALETTE.brandBlue }} />}
            title="Page not found"
            description={`Nothing lives at ${pathname}.`}
            primaryAction={
                <Button variant="contained" component={RouterLink} to="/">
                    Go to Dashboard
                </Button>
            }
        />
    );
}
