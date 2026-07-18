// Hover-prime the lazy chunk for a target route so the click-to-paint path
// no longer waits for the chunk to download. Each route maps to the same
// `import('./pages/X.js')` expression that App.tsx already feeds to
// `React.lazy` — calling it warms Vite's module cache (dev) and the browser's
// module/disk cache (production), and the duplicate work React.lazy does on
// the actual navigation is deduped because the dynamic import returns the
// same promise.

// Exported so the unit test can cover each loader arrow directly.
// prefetchRoute itself short-circuits in test mode (see the MODE guard
// below), so without this export the 15 loader functions would show as
// uncovered even though they behave correctly under the guard.
export const routes: Record<string, () => Promise<unknown>> = {
    // Sidenav and MoreSheet use `dashboard`; BottomNav uses `home`. Same chunk.
    dashboard: () => import('../pages/Dashboard.js'),
    home: () => import('../pages/Dashboard.js'),
    'scratch-pad': () => import('../pages/ScratchPad.js'),
    projects: () => import('../pages/Projects.js'),
    epics: () => import('../pages/Epics.js'),
    issues: () => import('../pages/Issues.js'),
    queue: () => import('../pages/Queue.js'),
    agents: () => import('../pages/Agents.js'),
    marketplace: () => import('../pages/Marketplace.js'),
    'mcp-tools': () => import('../pages/McpTools.js'),
    search: () => import('../pages/Search.js'),
    analytics: () => import('../pages/Analytics.js'),
    terminal: () => import('../pages/Terminal.js'),
    notifications: () => import('../pages/Notifications.js'),
    reminders: () => import('../pages/Reminders.js'),
    guardrails: () => import('../pages/Guardrails.js'),
    settings: () => import('../pages/Settings.js'),
};

const primed = new Set<string>();

export function prefetchRoute(key: string): void {
    if (primed.has(key)) return;
    const loader = routes[key];
    if (!loader) return;
    primed.add(key);
    // Vitest tears down the module registry between test files. A
    // fire-and-forget dynamic import kicked off from a component test
    // (e.g. BottomNav) resolves AFTER teardown and trips
    // EnvironmentTeardownError. Skip the real import in test mode;
    // production and dev still prime the chunk normally.
    if (import.meta.env.MODE === 'test') return;
    void loader();
}
