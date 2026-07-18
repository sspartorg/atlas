import { Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import { Sidenav, Topbar, ErrorBoundary } from './components/index.js';
import { BrandedFallback } from './components/BrandedFallback.js';
import {
    PageTitleProvider,
    MobileAppBar,
    BottomNav,
    MoreSheet,
    NavigationCurtain,
} from './components/shell/index.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { ShortcutsDialog } from './components/ShortcutsDialog.js';
import { Toast } from './components/Toast.js';
import { ToastProvider } from './hooks/useToast.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { MOBILE_SHELL, ATLAS_PALETTE } from './theme/tokens.js';
import { useSettings } from './hooks/useSettings.js';
import { useSSE } from './hooks/useSSE.js';

// Route components are code-split: each page lands in its own chunk and is
// fetched on first navigation. See `utils/lazyNamed.ts` for why the helper
// exists (named-export modules vs React.lazy's default-export contract).
import { lazyNamed } from './utils/lazyNamed.js';

const Dashboard = lazyNamed(() => import('./pages/Dashboard.js'), 'Dashboard');
const ScratchPad = lazyNamed(() => import('./pages/ScratchPad.js'), 'ScratchPad');
const Onboarding = lazyNamed(() => import('./pages/Onboarding.js'), 'Onboarding');
const Projects = lazyNamed(() => import('./pages/Projects.js'), 'Projects');
const ProjectDetail = lazyNamed(() => import('./pages/ProjectDetail.js'), 'ProjectDetail');
const Epics = lazyNamed(() => import('./pages/Epics.js'), 'Epics');
const EpicDetail = lazyNamed(() => import('./pages/EpicDetail.js'), 'EpicDetail');
const EpicNew = lazyNamed(() => import('./pages/EpicNew.js'), 'EpicNew');
const ProjectGuardrails = lazyNamed(
    () => import('./pages/ProjectGuardrails.js'),
    'ProjectGuardrails',
);
const Issues = lazyNamed(() => import('./pages/Issues.js'), 'Issues');
const StoryDetail = lazyNamed(() => import('./pages/StoryDetail.js'), 'StoryDetail');
const SubTaskDetail = lazyNamed(() => import('./pages/SubTaskDetail.js'), 'SubTaskDetail');
const SubBugDetail = lazyNamed(() => import('./pages/SubBugDetail.js'), 'SubBugDetail');
const BugDetail = lazyNamed(() => import('./pages/BugDetail.js'), 'BugDetail');
const Queue = lazyNamed(() => import('./pages/Queue.js'), 'Queue');
const Search = lazyNamed(() => import('./pages/Search.js'), 'Search');
const Terminal = lazyNamed(() => import('./pages/Terminal.js'), 'Terminal');
const TerminalSession = lazyNamed(() => import('./pages/TerminalSession.js'), 'TerminalSession');
const TerminalLayout = lazyNamed(() => import('./pages/TerminalLayout.js'), 'TerminalLayout');
const TerminalHistory = lazyNamed(() => import('./pages/TerminalHistory.js'), 'TerminalHistory');
const Agents = lazyNamed(() => import('./pages/Agents.js'), 'Agents');
const AgentDetail = lazyNamed(() => import('./pages/AgentDetail.js'), 'AgentDetail');
const Marketplace = lazyNamed(() => import('./pages/Marketplace.js'), 'Marketplace');
const MarketplaceAgentDetail = lazyNamed(
    () => import('./pages/MarketplaceAgentDetail.js'),
    'MarketplaceAgentDetail',
);
const AgentRunDetail = lazyNamed(() => import('./pages/AgentRunDetail.js'), 'AgentRunDetail');
const McpTools = lazyNamed(() => import('./pages/McpTools.js'), 'McpTools');
const Guardrails = lazyNamed(() => import('./pages/Guardrails.js'), 'Guardrails');
const Notifications = lazyNamed(() => import('./pages/Notifications.js'), 'Notifications');
const Reminders = lazyNamed(() => import('./pages/Reminders.js'), 'Reminders');
const Settings = lazyNamed(() => import('./pages/Settings.js'), 'Settings');
const Credentials = lazyNamed(() => import('./pages/Credentials.js'), 'Credentials');
const AnalyticsPage = lazyNamed(() => import('./pages/Analytics.js'), 'Analytics');
const AnalyticsProjectPage = lazyNamed(
    () => import('./pages/AnalyticsProject.js'),
    'AnalyticsProject',
);
const AnalyticsEpicPage = lazyNamed(
    () => import('./pages/AnalyticsEpic.js'),
    'AnalyticsEpic',
);

// Freshness model: SSE drives invalidation on every server-side mutation
// (see `useSSE`), so explicit re-fetch on every mount was pure waste — it
// re-fired the same data on every navigation while SSE was already telling
// us "nothing changed". staleTime: 30 s + gcTime: 5 min means a navigation
// within the same minute paints from cache and skips the network entirely;
// SSE still drops stale entries the moment data actually changes server-side.
// Window-focus + reconnect refetches stay aggressive — those signal that the
// tab might be drifting from the source of truth.
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: 'always',
            refetchOnReconnect: 'always',
        },
    },
});

function AppShell() {
    useSSE();
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const isMobile = useIsMobile();
    const location = useLocation();
    useGlobalShortcuts({ onOpenShortcuts: () => setShortcutsOpen(true) });

    // Register the service worker once per mount. Silent failure is
    // intentional — browsers without SW support (or with permission
    // blocked at the OS level) shouldn't surface a toast. The push
    // subscribe / unsubscribe flow lives in usePushSubscription and
    // only runs after explicit Owner action in Settings.
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }
    }, []);

    return (
        <ToastProvider>
            <PageTitleProvider>
                <Box
                    sx={{
                        display: 'flex',
                        height: '100vh',
                        overflow: 'hidden',
                        background: ATLAS_PALETTE.pageBg,
                    }}
                >
                    {!isMobile && <Sidenav />}
                    <Box
                        sx={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        {isMobile ? (
                            <MobileAppBar />
                        ) : (
                            <Topbar
                                onShortcutsOpen={() => setShortcutsOpen(true)}
                            />
                        )}
                        <Box
                            sx={{
                                flex: 1,
                                overflow: 'auto',
                                position: 'relative',
                                pb: isMobile
                                    ? `calc(${MOBILE_SHELL.bottomNavHeight}px + 48px + env(safe-area-inset-bottom))`
                                    : 0,
                            }}
                        >
                            <Suspense
                                key={location.pathname}
                                fallback={<BrandedFallback />}
                            >
                                <Outlet />
                            </Suspense>
                            <NavigationCurtain />
                        </Box>
                    </Box>
                    {isMobile && (
                        <>
                            <BottomNav onOpenMore={() => setMoreOpen(true)} />
                            <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
                        </>
                    )}
                    <ShortcutsDialog
                        open={shortcutsOpen}
                        onClose={() => setShortcutsOpen(false)}
                    />
                    <Toast />
                </Box>
            </PageTitleProvider>
        </ToastProvider>
    );
}

function RouteGuard() {
    const location = useLocation();
    const { data: settings, isLoading } = useSettings();

    if (isLoading) {
        // F-003 fix: use the BrandedFallback so the Atlas logo is visible
        // during the settings fetch. The previous bare CircularProgress on
        // pageBg looked like an outage in dark mode (#050505 surface, tiny
        // green dot — no chrome, no brand).
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: ATLAS_PALETTE.pageBg,
                }}
            >
                <BrandedFallback />
            </Box>
        );
    }

    if (!settings?.onboarding_complete && location.pathname !== '/onboarding') {
        return <Navigate to="/onboarding" replace />;
    }
    if (settings?.onboarding_complete && location.pathname === '/onboarding') {
        return <Navigate to="/" replace />;
    }
    return <Outlet />;
}

function Wrap({ name, children }: { name: string; children: React.ReactNode }) {
    return <ErrorBoundary pageName={name}>{children}</ErrorBoundary>;
}

export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <Routes>
                    <Route element={<RouteGuard />}>
                        <Route
                            path="/onboarding"
                            element={
                                <Wrap name="Onboarding">
                                    <Suspense fallback={<BrandedFallback />}>
                                        <Onboarding />
                                    </Suspense>
                                </Wrap>
                            }
                        />
                        <Route element={<AppShell />}>
                            <Route
                                path="/"
                                element={
                                    <Wrap name="Dashboard">
                                        <Dashboard />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/scratch-pad"
                                element={
                                    <Wrap name="Scratch Pad">
                                        <ScratchPad />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/projects"
                                element={
                                    <Wrap name="Projects">
                                        <Projects />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/projects/:id"
                                element={
                                    <Wrap name="Project">
                                        <ProjectDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/epics"
                                element={
                                    <Wrap name="Epics">
                                        <Epics />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/epics/new"
                                element={
                                    <Wrap name="New Epic">
                                        <EpicNew />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/epics/:id"
                                element={
                                    <Wrap name="Epic">
                                        <EpicDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/projects/:id/guard-rails"
                                element={
                                    <Wrap name="Project Guard-rails">
                                        <ProjectGuardrails />
                                    </Wrap>
                                }
                            />
                            {/* No-hyphen alias matches the natural form; redirects through the
                                same Navigate the canonical path renders. */}
                            <Route
                                path="/projects/:id/guardrails"
                                element={
                                    <Wrap name="Project Guard-rails">
                                        <ProjectGuardrails />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/issues"
                                element={
                                    <Wrap name="Issues">
                                        <Issues />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/issues/stories/:id"
                                element={
                                    <Wrap name="Story">
                                        <StoryDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/issues/sub-tasks/:id"
                                element={
                                    <Wrap name="Sub-task">
                                        <SubTaskDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/issues/sub-bugs/:id"
                                element={
                                    <Wrap name="Sub-bug">
                                        <SubBugDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/issues/bugs/:id"
                                element={
                                    <Wrap name="Bug">
                                        <BugDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/queue"
                                element={
                                    <Wrap name="Queue">
                                        <Queue />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/search"
                                element={
                                    <Wrap name="Search">
                                        <Search />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/terminal"
                                element={
                                    <Wrap name="Terminal">
                                        <Terminal />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/terminal/layout"
                                element={
                                    <Wrap name="Terminal Layout">
                                        <TerminalLayout />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/terminal/:id/history"
                                element={
                                    <Wrap name="Terminal History">
                                        <TerminalHistory />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/terminal/:id"
                                element={
                                    <Wrap name="Terminal Session">
                                        <TerminalSession />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents"
                                element={
                                    <Wrap name="Agents">
                                        <Agents />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents/mcp-tools"
                                element={
                                    <Wrap name="MCP Tools">
                                        <McpTools />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents/marketplace"
                                element={
                                    <Wrap name="Marketplace">
                                        <Marketplace />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents/marketplace/:id"
                                element={
                                    <Wrap name="Marketplace agent">
                                        <MarketplaceAgentDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents/:id"
                                element={
                                    <Wrap name="Agent">
                                        <AgentDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/agents/:id/runs/:runId"
                                element={
                                    <Wrap name="Run">
                                        <AgentRunDetail />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/notifications"
                                element={
                                    <Wrap name="Notifications">
                                        <Notifications />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/reminders"
                                element={
                                    <Wrap name="Reminders">
                                        <Reminders />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/guardrails"
                                element={
                                    <Wrap name="Guard-rails">
                                        <Guardrails />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/settings"
                                element={
                                    <Wrap name="Settings">
                                        <Settings />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/settings/credentials"
                                element={
                                    <Wrap name="Credentials">
                                        <Credentials />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/analytics"
                                element={
                                    <Wrap name="Analytics">
                                        <AnalyticsPage />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/analytics/project/:projectId"
                                element={
                                    <Wrap name="AnalyticsProject">
                                        <AnalyticsProjectPage />
                                    </Wrap>
                                }
                            />
                            <Route
                                path="/analytics/epic/:epicId"
                                element={
                                    <Wrap name="AnalyticsEpic">
                                        <AnalyticsEpicPage />
                                    </Wrap>
                                }
                            />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Route>
                    </Route>
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>
    );
}
