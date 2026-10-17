import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { API } from './api.js';

// A stand-in for github.com, for git only, on the e2e API alone. Global setup
// gives that API `url.<file dir>.insteadOf` for this org (via GIT_CONFIG_COUNT,
// so the developer's git config is untouched), so Add repo's clone, connect's
// ls-remote and later fetches reach local bare repos — no network, no real
// token. Other github.com URLs are not rewritten.

const FAKE_GITHUB_ORG = 'atlas-e2e';
const FAKE_GITHUB_DIR = join(tmpdir(), 'atlas-e2e-github');
/** A PAT whose clone URL (`https://x-access-token:<token>@github.com/…`) the rewrite also covers. */
const FAKE_GITHUB_TOKEN = 'ghpE2Efakegithubtoken0000000001';

/** Env for the API under test: both URL shapes the API uses map to FAKE_GITHUB_DIR. */
export function fakeGithubGitEnv(): Record<string, string> {
    const base = `file://${FAKE_GITHUB_DIR}/${FAKE_GITHUB_ORG}/`;
    return {
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: `url.${base}.insteadOf`,
        GIT_CONFIG_VALUE_0: `https://github.com/${FAKE_GITHUB_ORG}/`,
        GIT_CONFIG_KEY_1: `url.${base}.insteadOf`,
        GIT_CONFIG_VALUE_1: `https://x-access-token:${FAKE_GITHUB_TOKEN}@github.com/${FAKE_GITHUB_ORG}/`,
    };
}

/**
 * A bare repo at https://github.com/atlas-e2e/<name>.git (as the e2e API sees
 * it) with one commit on `branch`. Returns that URL.
 */
export function fakeGithubRepo(name: string, branch = 'main'): string {
    const bare = join(FAKE_GITHUB_DIR, FAKE_GITHUB_ORG, `${name}.git`);
    const work = join(FAKE_GITHUB_DIR, '_work', name);
    rmSync(bare, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe', cwd: work });
    git('init', '--bare', '-b', branch, bare);
    git('init', '-b', branch);
    writeFileSync(join(work, 'README.md'), `# ${name}\n`);
    git('add', '.');
    git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-m', 'init');
    git('remote', 'add', 'origin', bare);
    git('push', 'origin', branch);
    return `https://github.com/${FAKE_GITHUB_ORG}/${name}.git`;
}

/** A local clone of a fake repo whose `origin` reads as the GitHub URL (for connect mode). */
export function fakeGithubClone(name: string, folder: string): string {
    const url = fakeGithubRepo(name);
    rmSync(folder, { recursive: true, force: true });
    execFileSync('git', ['clone', join(FAKE_GITHUB_DIR, FAKE_GITHUB_ORG, `${name}.git`), folder], { stdio: 'pipe' });
    execFileSync('git', ['remote', 'set-url', 'origin', url], { stdio: 'pipe', cwd: folder });
    return url;
}

/** The bare repo behind a fake GitHub URL. */
const fakeGithubBare = (name: string): string => join(FAKE_GITHUB_DIR, FAKE_GITHUB_ORG, `${name}.git`);

/** Commit `file` to the fake repo's `branch` (through a scratch clone), as if someone pushed to GitHub. */
export function fakeGithubPush(name: string, file: string, branch = 'main'): void {
    const work = join(FAKE_GITHUB_DIR, '_work', `${name}-push-${Date.now()}`);
    execFileSync('git', ['clone', '-b', branch, fakeGithubBare(name), work], { stdio: 'pipe' });
    writeFileSync(join(work, file), `${file}\n`);
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe', cwd: work });
    git('add', file);
    git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-m', `add ${file}`);
    git('push', 'origin', branch);
    rmSync(work, { recursive: true, force: true });
}

/** Branches on the fake repo. */
export function fakeGithubBranches(name: string): string[] {
    return execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: fakeGithubBare(name), encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
}

export function removeFakeGithubRepo(name: string): void {
    rmSync(fakeGithubBare(name), { recursive: true, force: true });
    rmSync(join(FAKE_GITHUB_DIR, '_work', name), { recursive: true, force: true });
}

/** `gh pr create` calls the fake gh (fixtures/fake-gh) answered, oldest first. */
export function fakeGhCalls(): Array<{ repo: string; head: string; base: string; title: string; cwd: string }> {
    try {
        return readFileSync(join(FAKE_GITHUB_DIR, 'gh-calls.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as { repo: string; head: string; base: string; title: string; cwd: string });
    } catch {
        return [];
    }
}

/** A PAT the fake GitHub accepts (its token is the one the insteadOf rule covers). */
export async function fakeGithubCredential(request: APIRequestContext, label: string): Promise<string> {
    const res = await request.post(`${API}/api/credentials`, { data: { label, kind: 'pat', token: FAKE_GITHUB_TOKEN } });
    if (res.status() >= 300) throw new Error(`POST /api/credentials: ${res.status()} ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
}
