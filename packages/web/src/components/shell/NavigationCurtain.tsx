import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import { BrandedFallback } from '../BrandedFallback.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Warm React.lazy chunks resolve synchronously, so the keyed AppShell Suspense
// never throws on the second visit to a route. This overlay fills that gap with
// a brief feedback flash. Keyed by pathname only — tab swaps and filter changes
// (?tab=, ?status=, ...) keep the page mounted and rely on per-tab skeletons.
const CURTAIN_MS = 350;

export function NavigationCurtain() {
    const location = useLocation();
    const key = location.pathname;
    const isFirstMount = useRef(true);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            return;
        }
        setVisible(true);
        const timer = window.setTimeout(() => setVisible(false), CURTAIN_MS);
        return () => window.clearTimeout(timer);
    }, [key]);

    if (!visible) return null;

    return (
        <Box
            aria-hidden
            sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                bgcolor: ATLAS_PALETTE.pageBg,
                pointerEvents: 'auto',
            }}
        >
            <BrandedFallback />
        </Box>
    );
}
