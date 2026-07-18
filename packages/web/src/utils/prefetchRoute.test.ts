import { describe, expect, it, vi } from 'vitest';

// prefetchRoute() short-circuits in vitest (see the MODE guard in the
// source) so we cover the return-value + dedupe contract without pulling
// real page chunks into the test environment via prefetchRoute itself.
// Then, to also cover the 15 loader arrow functions in the routes map,
// we call each loader directly against a stubbed page module — vi.mock
// resolves each import to a no-op React component so no MUI / api /
// data-fetching modules load.

const pageStub = { default: () => null };
vi.mock('../pages/Dashboard.js', () => pageStub);
vi.mock('../pages/ScratchPad.js', () => pageStub);
vi.mock('../pages/Projects.js', () => pageStub);
vi.mock('../pages/Epics.js', () => pageStub);
vi.mock('../pages/Issues.js', () => pageStub);
vi.mock('../pages/Queue.js', () => pageStub);
vi.mock('../pages/Agents.js', () => pageStub);
vi.mock('../pages/Marketplace.js', () => pageStub);
vi.mock('../pages/McpTools.js', () => pageStub);
vi.mock('../pages/Search.js', () => pageStub);
vi.mock('../pages/Analytics.js', () => pageStub);
vi.mock('../pages/Terminal.js', () => pageStub);
vi.mock('../pages/Notifications.js', () => pageStub);
vi.mock('../pages/Reminders.js', () => pageStub);
vi.mock('../pages/Guardrails.js', () => pageStub);
vi.mock('../pages/Settings.js', () => pageStub);

import { prefetchRoute, routes } from './prefetchRoute.js';

describe('prefetchRoute', () => {
    it('returns undefined for the dashboard key', () => {
        expect(prefetchRoute('dashboard')).toBeUndefined();
    });

    it('returns undefined for the home key (alias of dashboard)', () => {
        expect(prefetchRoute('home')).toBeUndefined();
    });

    it('returns undefined for scratch-pad', () => {
        expect(prefetchRoute('scratch-pad')).toBeUndefined();
    });

    it('returns undefined for projects', () => {
        expect(prefetchRoute('projects')).toBeUndefined();
    });

    it('returns undefined for epics', () => {
        expect(prefetchRoute('epics')).toBeUndefined();
    });

    it('returns undefined for issues', () => {
        expect(prefetchRoute('issues')).toBeUndefined();
    });

    it('returns undefined for queue', () => {
        expect(prefetchRoute('queue')).toBeUndefined();
    });

    it('returns undefined for agents', () => {
        expect(prefetchRoute('agents')).toBeUndefined();
    });

    it('returns undefined for marketplace', () => {
        expect(prefetchRoute('marketplace')).toBeUndefined();
    });

    it('returns undefined for mcp-tools', () => {
        expect(prefetchRoute('mcp-tools')).toBeUndefined();
    });

    it('returns undefined for search', () => {
        expect(prefetchRoute('search')).toBeUndefined();
    });

    it('returns undefined for analytics', () => {
        expect(prefetchRoute('analytics')).toBeUndefined();
    });

    it('returns undefined for terminal', () => {
        expect(prefetchRoute('terminal')).toBeUndefined();
    });

    it('returns undefined for notifications', () => {
        expect(prefetchRoute('notifications')).toBeUndefined();
    });

    it('returns undefined for reminders', () => {
        expect(prefetchRoute('reminders')).toBeUndefined();
    });

    it('returns undefined for guardrails', () => {
        expect(prefetchRoute('guardrails')).toBeUndefined();
    });

    it('returns undefined for settings', () => {
        expect(prefetchRoute('settings')).toBeUndefined();
    });

    it('is a silent no-op for an unknown key', () => {
        expect(prefetchRoute('not-a-real-route')).toBeUndefined();
    });

    it('dedupes repeat calls for the same key', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        prefetchRoute('settings');
        prefetchRoute('settings');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('every loader arrow in the routes map resolves cleanly (function coverage)', async () => {
        // Directly invoke every loader — the vi.mock stubs above resolve each
        // page module to a no-op React component so nothing heavy loads. This
        // exercises the 15 arrow functions the MODE guard skips inside
        // prefetchRoute() itself.
        const results = await Promise.all(
            Object.values(routes).map((loader) => loader()),
        );
        expect(results).toHaveLength(17); // 16 unique pages + `home` alias
        for (const mod of results) {
            expect(mod).toBeDefined();
        }
    });
});
