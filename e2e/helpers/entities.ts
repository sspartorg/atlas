import { expect, type Page } from '@playwright/test';

// G-018 — resolve a real entity id from the API instead of scraping an
// `<a href>` out of the list page.
//
// Ten specs used to do this:
//
//     const first = page.locator('a[href^="/agents/"]').first();
//     if ((await first.count()) === 0) {
//         test.skip(true, 'no seeded agent — skipping …');
//     }
//
// Both halves are wrong. The app navigates its list cards with `onClick`
// handlers, not anchors, so the locator finds nothing **even though the seed
// installs `agent-po-writer` and creates a project, a repo and an item**. And
// the skip message blames missing data for what is a selector that no longer
// matches the markup, so the test abstains, reports a cause nobody verified,
// and reads as green.
//
// That is the same failure as G-009, one layer up: a test that does not run
// cannot fail. Twenty-nine specs were abstaining this way.
//
// These helpers ask the API — the same source the page renders from — and
// `expect` a non-empty answer, so a genuinely empty fixture is a loud failure
// with a useful message rather than a silent skip.

async function apiList<T>(page: Page, path: string): Promise<T[]> {
    const res = await page.request.get(path);
    expect(res.ok(), `GET ${path} → ${res.status()}`).toBe(true);
    const body = (await res.json()) as T[] | { items?: T[] };
    return Array.isArray(body) ? body : (body.items ?? []);
}

/** The seeded project. Fails loudly if the seed did not create one. */
export async function firstProjectId(page: Page): Promise<string> {
    const rows = await apiList<{ id: string }>(page, '/api/projects');
    expect(rows.length, 'e2e seed created no project — fixture is broken, not absent').toBeGreaterThan(0);
    return rows[0]!.id;
}

/** The installed agent (`agent-po-writer`). Fails loudly if none is installed. */
export async function firstAgentId(page: Page): Promise<string> {
    const rows = await apiList<{ id: string }>(page, '/api/agents');
    expect(rows.length, 'e2e seed installed no agent — fixture is broken, not absent').toBeGreaterThan(0);
    return rows[0]!.id;
}

/**
 * The newest agent run, or `null`.
 *
 * Unlike the others this one may legitimately be empty: the seed installs an
 * agent but never starts a run, and starting one would spawn a CLI. A caller
 * that skips on `null` is being honest; a caller that skipped because it could
 * not find an anchor was not.
 */
export async function firstAgentRunId(page: Page): Promise<string | null> {
    const rows = await apiList<{ id: string }>(page, '/api/run');
    return rows[0]?.id ?? null;
}

/** A marketplace catalog entry. The catalog is seeded from disk, so never empty. */
export async function firstMarketplaceAgentId(page: Page): Promise<string> {
    const rows = await apiList<{ id: string }>(page, '/api/marketplace/agents');
    expect(rows.length, 'marketplace catalog is empty — the seed did not sync it').toBeGreaterThan(0);
    return rows[0]!.id;
}
