import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import { useLocation, useNavigate } from 'react-router-dom';
import { ATLAS_PALETTE, MOBILE_SHELL } from '../../theme/tokens.js';
import { prefetchRoute } from '../../utils/prefetchRoute.js';
import { useConfirmLeave } from '../../hooks/useDraftGuard.js';

interface Props {
    onOpenMore: () => void;
}

type TabKey = 'home' | 'tasks' | 'queue' | 'more';

interface TabSpec {
    key: TabKey;
    label: string;
    icon: string;
    path: string | null;
    matches: (pathname: string) => boolean;
}

const TABS: TabSpec[] = [
    {
        key: 'home',
        label: 'Home',
        icon: 'grid_view',
        path: '/',
        matches: (p) => p === '/',
    },
    {
        key: 'tasks',
        label: 'Tasks',
        icon: 'flag',
        path: '/tasks',
        matches: (p) => p.startsWith('/tasks') || p.startsWith('/sub-tasks/'),
    },
    {
        key: 'queue',
        label: 'Queue',
        icon: 'schedule',
        path: '/queue',
        matches: (p) => p === '/queue',
    },
    {
        key: 'more',
        label: 'More',
        icon: 'more_horiz',
        path: null,
        matches: () => false,
    },
];

export function BottomNav({ onOpenMore }: Props) {
    const navigate = useNavigate();
    const confirmLeave = useConfirmLeave();
    const { pathname } = useLocation();
    const activeKey = TABS.find((t) => t.matches(pathname))?.key ?? null;

    return (
        <Box
            component="nav"
            sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: (t) => t.zIndex.appBar,
                background: ATLAS_PALETTE.white,
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            <BottomNavigation
                value={activeKey ?? false}
                showLabels
                sx={{
                    height: MOBILE_SHELL.bottomNavHeight,
                    background: 'transparent',
                    '& .MuiBottomNavigationAction-root': {
                        color: ATLAS_PALETTE.slate60,
                        minWidth: 0,
                        padding: '6px 0',
                    },
                    '& .Mui-selected': {
                        color: ATLAS_PALETTE.green,
                    },
                    '& .MuiBottomNavigationAction-label': {
                        fontSize: 11,
                        fontWeight: 500,
                        '&.Mui-selected': { fontSize: 11 },
                    },
                }}
            >
                {TABS.map((tab) => (
                    <BottomNavigationAction
                        key={tab.key}
                        value={tab.key}
                        label={tab.label}
                        onClick={() => {
                            if (tab.key === 'more') {
                                onOpenMore();
                                return;
                            }
                            const { path } = tab;
                            if (path) confirmLeave(() => navigate(path));
                        }}
                        onPointerEnter={() => {
                            if (tab.key !== 'more') prefetchRoute(tab.key);
                        }}
                        icon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 24,
                                    fontVariationSettings:
                                        activeKey === tab.key ? "'FILL' 1" : "'FILL' 0",
                                }}
                            >
                                {tab.icon}
                            </Box>
                        }
                    />
                ))}
            </BottomNavigation>
        </Box>
    );
}
