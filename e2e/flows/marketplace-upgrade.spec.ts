import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Marketplace upgrade flow.
//
// Seed guarantees (run-seed.ts):
//   - marketplace catalog synced (agent-po-writer at version 1)
//   - agent-po-writer installed via marketplaceService.install()
//     => marketplace_pulled_version = 1, marketplace_source_id = 'agent-po-writer'
//
// Upgrade-available state cannot be simulated without a direct DB write
// (pulled_version < catalog version) and the catalog version is fixed at 1.
// This suite therefore covers the full API surface that backs the upgrade UI
// and the diff endpoint that the Accept-Upgrade modal calls. A future spec
// can inject an upgrade state via a catalog version bump in the seed.

const API = 'http://127.0.0.1:6001';

test.describe('Marketplace upgrade flow', () => {
    // Test 1: GET /api/marketplace/agents returns PO Writer with version info
    test('GET /api/marketplace/agents lists PO Writer with version and install status', async ({ request }) => {
        const res = await request.get(`${API}/api/marketplace/agents`);
        expect(res.status()).toBe(200);
        const catalog = await res.json() as Array<Record<string, unknown>>;
        expect(Array.isArray(catalog)).toBe(true);

        const poWriter = catalog.find((e) => e['id'] === 'agent-po-writer');
        expect(poWriter).toBeDefined();
        expect(typeof poWriter!['version']).toBe('number');
        expect(poWriter!['version']).toBeGreaterThanOrEqual(1);
        expect(poWriter!['is_installed']).toBe(true);
        expect(poWriter!['installed_agent_id']).toBe('agent-po-writer');
        // After a fresh install (pulled == catalog version) upgrade is NOT due.
        expect(poWriter!['upgrade_available']).toBe(false);
    });

    // Test 2: GET /api/agents returns PO Writer with marketplace linkage fields
    test('GET /api/agents includes PO Writer with matching marketplace_pulled_version', async ({ request }) => {
        const res = await request.get(`${API}/api/agents`);
        expect(res.status()).toBe(200);
        const agents = await res.json() as Array<Record<string, unknown>>;
        expect(Array.isArray(agents)).toBe(true);

        const agent = agents.find((a) => a['id'] === 'agent-po-writer');
        expect(agent).toBeDefined();
        expect(agent!['marketplace_source_id']).toBe('agent-po-writer');
        expect(typeof agent!['marketplace_pulled_version']).toBe('number');

        // Catalog version is fixed at 1 after install; pulled version must match.
        const catalogRes = await request.get(`${API}/api/marketplace/agents/agent-po-writer`);
        expect(catalogRes.status()).toBe(200);
        const { agent: catalogAgent } = await catalogRes.json() as { agent: Record<string, unknown> };
        expect(agent!['marketplace_pulled_version']).toBe(catalogAgent['version']);
    });

    // Test 3: GET /api/marketplace/agents/:id/diff/:agent_id returns a clean diff
    // This is the endpoint the Accept-Upgrade modal calls to compute the field
    // change list. With pulled_version == catalog version there are no changes,
    // but the endpoint must still return a valid IMarketplaceUpgradeDiff shape.
    test('GET diff endpoint returns a valid diff shape with no changed fields', async ({ request }) => {
        const res = await request.get(
            `${API}/api/marketplace/agents/agent-po-writer/diff/agent-po-writer`,
        );
        expect(res.status()).toBe(200);
        const diff = await res.json() as Record<string, unknown>;
        expect(diff['marketplace_id']).toBe('agent-po-writer');
        expect(diff['local_agent_id']).toBe('agent-po-writer');
        expect(typeof diff['marketplace_version']).toBe('number');
        expect(typeof diff['local_pulled_version']).toBe('number');
        const fields = diff['fields'] as Record<string, { changed: boolean }>;
        expect(fields['prompt_md']).toBeDefined();
        // Fresh install: no fields should be changed.
        for (const key of Object.keys(fields)) {
            expect(fields[key]!['changed']).toBe(false);
        }
    });

    // Test 4 (browser): /agents/marketplace shows PO Writer with Installed badge.
    // Navigate to detail page and confirm it renders.
    test('browser: marketplace list shows PO Writer Installed badge + detail page renders', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(page.getByText(/PO Writer/i).first()).toBeVisible({ timeout: 10_000 });
        // The installed agent card renders an "Installed" indicator.
        await expect(page.getByText(/Installed/i).first()).toBeVisible({ timeout: 10_000 });

        // Navigate to the detail page for the PO Writer catalog entry.
        await goto(page, '/agents/marketplace/agent-po-writer');
        await expect(page.getByText(/PO Writer/i).first()).toBeVisible({ timeout: 10_000 });
    });
});
