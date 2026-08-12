import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    readFileSync,
    writeFileSync,
    existsSync,
    rmSync,
    mkdtempSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGitAuth, buildGitConfig, cleanupGitConfig } from './git-credentials.js';

function shAvailable(): boolean {
    try {
        execFileSync('sh', ['-c', 'echo ok'], { stdio: 'pipe', timeout: 5_000 });
        return true;
    } catch {
        return false;
    }
}

// The service under test is intentionally excluded from coverage
// aggregation (see vitest.config.ts), but this file adds behavioural
// checks for the [user]-section branch introduced by migration 024 and
// the prepare-commit-msg hook branch introduced by migration 025 so
// we don't regress the bot-identity commit path.

const svc = {
    get: vi.fn(),
    getToken: vi.fn(),
};

vi.mock('./credentials.js', () => ({
    credentialsService: {
        get: (...args: unknown[]) => svc.get(...args),
        getToken: (...args: unknown[]) => svc.getToken(...args),
    },
}));

function readFile(path: string): string {
    return readFileSync(path, 'utf-8');
}

describe('buildGitAuth', () => {
    const cleanupDirs: string[] = [];

    beforeEach(() => {
        svc.get.mockReset();
        svc.getToken.mockReset();
    });

    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const d = cleanupDirs.pop()!;
            if (existsSync(d)) rmSync(d, { recursive: true, force: true });
        }
    });

    it('returns null for a null credential id (no-op)', async () => {
        expect(await buildGitAuth(null)).toBeNull();
        expect(await buildGitConfig(null)).toEqual({ configPath: null, transient: false });
    });

    it('returns null when the credential lookup misses (no throw)', async () => {
        svc.get.mockResolvedValueOnce(undefined);
        expect(await buildGitAuth('missing')).toBeNull();
    });

    it('writes an http.extraheader + credential.helper block for a PAT credential', async () => {
        svc.get.mockResolvedValueOnce({
            id: 'p1',
            kind: 'pat',
            username: 'x-access-token',
            app_id: null,
            app_slug: null,
            human_name: null,
            human_email: null,
            human_gh_login: null,
        });
        svc.getToken.mockResolvedValueOnce('ghp_fake_token_1234');
        const auth = await buildGitAuth('p1');
        expect(auth).not.toBeNull();
        cleanupDirs.push(auth!.configDir);
        expect(auth!.token).toBe('ghp_fake_token_1234');
        expect(auth!.humanGhLogin).toBeNull();
        const content = readFile(auth!.configPath);
        expect(content).toContain('[http]');
        expect(content).toContain('extraheader = AUTHORIZATION: basic ');
        expect(content).toContain('[credential]');
        expect(content).toContain('helper =');
        expect(content).not.toContain('[user]');
        expect(content).not.toContain('[core]');
        const expectedB64 = Buffer.from('x-access-token:ghp_fake_token_1234', 'utf8').toString(
            'base64',
        );
        expect(content).toContain(expectedB64);
        // No hook file when human_* isn't set.
        expect(existsSync(join(auth!.configDir, 'prepare-commit-msg'))).toBe(false);
    });

    it('adds [user] name / email for a PAT credential carrying both human fields', async () => {
        // On a PAT the human IS the author (no bot identity exists), so this
        // is a `[user]` block — not the Co-Authored-By hook the github_app
        // branch installs. Without it, `git commit` inside a session silently
        // falls back to the host machine's ~/.gitconfig identity.
        svc.get.mockResolvedValueOnce({
            id: 'p2',
            kind: 'pat',
            username: 'x-access-token',
            app_id: null,
            app_slug: null,
            human_name: 'Ada Lovelace',
            human_email: 'ada@example.com',
            human_gh_login: null,
        });
        svc.getToken.mockResolvedValueOnce('ghp_fake_token_1234');
        const auth = await buildGitAuth('p2');
        cleanupDirs.push(auth!.configDir);
        const content = readFile(auth!.configPath);
        expect(content).toContain('[user]');
        expect(content).toContain('name = Ada Lovelace');
        expect(content).toContain('email = ada@example.com');
        // No co-author hook — self-co-authorship would be noise.
        expect(content).not.toContain('[core]');
        expect(existsSync(join(auth!.configDir, 'prepare-commit-msg'))).toBe(false);
        // The trailer fields stay github_app-only for the same reason.
        expect(auth!.humanName).toBeNull();
        expect(auth!.humanEmail).toBeNull();
    });

    it.each([
        ['name only', 'Ada Lovelace', null],
        ['email only', null, 'ada@example.com'],
    ])(
        'omits [user] for a PAT credential with %s (never half an identity)',
        async (_label, humanName, humanEmail) => {
            svc.get.mockResolvedValueOnce({
                id: 'p3',
                kind: 'pat',
                username: 'x-access-token',
                app_id: null,
                app_slug: null,
                human_name: humanName,
                human_email: humanEmail,
                human_gh_login: null,
            });
            svc.getToken.mockResolvedValueOnce('ghp_fake_token_1234');
            const auth = await buildGitAuth('p3');
            cleanupDirs.push(auth!.configDir);
            expect(readFile(auth!.configPath)).not.toContain('[user]');
        },
    );

    it('adds [user] name / email for a github_app credential with slug+app_id', async () => {
        svc.get.mockResolvedValue({
            id: 'g1',
            kind: 'github_app',
            username: 'x-access-token',
            app_id: 12345678,
            app_slug: 'atlas-app-bot',
            human_name: null,
            human_email: null,
            human_gh_login: null,
        });
        svc.getToken.mockResolvedValueOnce('ghs_installation_token');
        const auth = await buildGitAuth('g1');
        expect(auth).not.toBeNull();
        cleanupDirs.push(auth!.configDir);
        const content = readFile(auth!.configPath);
        expect(content).toContain('[user]');
        expect(content).toContain('name = atlas-app-bot[bot]');
        expect(content).toContain(
            'email = 12345678+atlas-app-bot[bot]@users.noreply.github.com',
        );
        // Still no hook without human_*.
        expect(content).not.toContain('[core]');
        expect(existsSync(join(auth!.configDir, 'prepare-commit-msg'))).toBe(false);
    });

    it('omits [user] when github_app credential has no slug yet (pre-backfill)', async () => {
        svc.get.mockResolvedValue({
            id: 'g2',
            kind: 'github_app',
            username: 'x-access-token',
            app_id: 12345678,
            app_slug: null,
            human_name: null,
            human_email: null,
            human_gh_login: null,
        });
        svc.getToken.mockResolvedValueOnce('ghs_installation_token');
        const auth = await buildGitAuth('g2');
        expect(auth).not.toBeNull();
        cleanupDirs.push(auth!.configDir);
        expect(readFile(auth!.configPath)).not.toContain('[user]');
    });

    it('installs a prepare-commit-msg hook when github_app credential has human_name + human_email', async () => {
        svc.get.mockResolvedValue({
            id: 'g3',
            kind: 'github_app',
            username: 'x-access-token',
            app_id: 12345678,
            app_slug: 'atlas-app-bot',
            human_name: 'sspart',
            human_email: 'sspart.org@gmail.com',
            human_gh_login: 'sspartorg',
        });
        svc.getToken.mockResolvedValueOnce('ghs_installation_token');
        const auth = await buildGitAuth('g3');
        expect(auth).not.toBeNull();
        cleanupDirs.push(auth!.configDir);
        expect(auth!.humanGhLogin).toBe('sspartorg');
        const config = readFile(auth!.configPath);
        expect(config).toContain('[core]');
        expect(config).toContain('hooksPath = ');
        expect(config).toContain(auth!.configDir.replace(/\\/g, '/'));
        // Bot stays as primary author.
        expect(config).toContain('name = atlas-app-bot[bot]');
        // Hook file exists and contains the trailer as a literal string.
        const hookPath = join(auth!.configDir, 'prepare-commit-msg');
        expect(existsSync(hookPath)).toBe(true);
        const hook = readFile(hookPath);
        expect(hook).toContain('#!/bin/sh');
        expect(hook).toContain(
            'Co-Authored-By: sspart <sspart.org@gmail.com>',
        );
        // Idempotency guard is present.
        expect(hook).toContain('grep -qxF');
        // Regression guard for a bug we hit in the field: the shell
        // interpolations were previously escaped as `\$1` / `\$COMMIT_MSG_FILE`
        // / `\$TRAILER` in the JS template literal, which shell interprets
        // as LITERAL `$foo` strings inside double quotes rather than
        // variable references. The hook then silently no-op'd on every
        // commit. Assert the correct unescaped form is emitted.
        expect(hook).toContain('COMMIT_MSG_FILE="$1"');
        expect(hook).toContain('"$COMMIT_MSG_FILE"');
        expect(hook).toContain('"$TRAILER"');
        expect(hook).not.toContain('\\$1');
        expect(hook).not.toContain('\\$COMMIT_MSG_FILE');
        expect(hook).not.toContain('\\$TRAILER');
    });

    it.skipIf(!shAvailable())(
        'the emitted hook actually appends the trailer when executed by sh',
        async () => {
            svc.get.mockResolvedValue({
                id: 'exec1',
                kind: 'github_app',
                username: 'x-access-token',
                app_id: 12345678,
                app_slug: 'atlas-app-bot',
                human_name: 'sspart',
                human_email: 'sspart.org@gmail.com',
                human_gh_login: 'sspartorg',
            });
            svc.getToken.mockResolvedValueOnce('ghs_installation_token');
            const auth = await buildGitAuth('exec1');
            cleanupDirs.push(auth!.configDir);
            const hookPath = join(auth!.configDir, 'prepare-commit-msg');

            // Prepare a fake COMMIT_EDITMSG.
            const msgDir = mkdtempSync(join(tmpdir(), 'atlas-hook-test-'));
            cleanupDirs.push(msgDir);
            const msgFile = join(msgDir, 'COMMIT_EDITMSG');
            writeFileSync(msgFile, 'Terminal session changes\n');

            // Run the hook the same way git would: pass the message file
            // path as $1.
            execFileSync('sh', [hookPath, msgFile], { stdio: 'pipe', timeout: 10_000 });

            const after = readFileSync(msgFile, 'utf-8');
            expect(after).toContain('Terminal session changes');
            expect(after).toContain(
                'Co-Authored-By: sspart <sspart.org@gmail.com>',
            );

            // Second run must be a no-op (idempotent under `git commit --amend`).
            execFileSync('sh', [hookPath, msgFile], { stdio: 'pipe', timeout: 10_000 });
            const afterTwice = readFileSync(msgFile, 'utf-8');
            const trailerCount = afterTwice.split('Co-Authored-By: sspart').length - 1;
            expect(trailerCount).toBe(1);
        },
    );

    it('omits the hook when only one of human_name / human_email is set', async () => {
        svc.get.mockResolvedValue({
            id: 'g4',
            kind: 'github_app',
            username: 'x-access-token',
            app_id: 12345678,
            app_slug: 'atlas-app-bot',
            human_name: 'sspart',
            human_email: null, // <- missing half
            human_gh_login: 'sspartorg',
        });
        svc.getToken.mockResolvedValueOnce('ghs_installation_token');
        const auth = await buildGitAuth('g4');
        cleanupDirs.push(auth!.configDir);
        expect(readFile(auth!.configPath)).not.toContain('[core]');
        expect(existsSync(join(auth!.configDir, 'prepare-commit-msg'))).toBe(false);
    });
});

describe('cleanupGitConfig', () => {
    const localCleanupDirs: string[] = [];
    afterEach(() => {
        while (localCleanupDirs.length > 0) {
            const d = localCleanupDirs.pop()!;
            if (existsSync(d)) rmSync(d, { recursive: true, force: true });
        }
    });

    it('is safe with null', () => {
        expect(() => cleanupGitConfig(null)).not.toThrow();
    });

    it('is safe with a non-existent path (best-effort recursive unlink)', () => {
        expect(() =>
            cleanupGitConfig('C:/tmp/atlas-git-fake/config'),
        ).not.toThrow();
    });

    it('REFUSES to rm a dir whose basename does not start with atlas-git-', () => {
        // Landmine we're guarding against: a caller passes
        // `/some/tmp/config` whose dirname is `/some/tmp`. A naive
        // rmSync(recursive) would trash `/some/tmp` entirely. The
        // safety belt keys off the resolved target's basename.
        const sentinel = mkdtempSync(join(tmpdir(), 'sentinel-not-atlas-'));
        localCleanupDirs.push(sentinel);
        writeFileSync(join(sentinel, 'config'), 'important-user-data');
        // Point cleanup at the config file inside a non-atlas-git-*
        // dir; it must be a no-op.
        cleanupGitConfig(join(sentinel, 'config'));
        // The dir + file should still exist.
        expect(existsSync(sentinel)).toBe(true);
        expect(existsSync(join(sentinel, 'config'))).toBe(true);
    });

    it('REFUSES to rm the raw tmpdir when passed a bare config file inside it', () => {
        // Even more extreme: a legacy call passes a path directly in
        // /tmp. dirname resolves to /tmp itself. Safety belt must catch.
        const fakePath = join(tmpdir(), 'legacy-file.config');
        // Don't actually create the file; the check should fire before
        // any rmSync. The assertion is: this call is a no-op that
        // doesn't throw and doesn't touch anything else.
        expect(() => cleanupGitConfig(fakePath)).not.toThrow();
    });

    it('removes the whole temp dir when given the config file path', async () => {
        svc.get.mockResolvedValue({
            id: 'c1',
            kind: 'github_app',
            username: 'x-access-token',
            app_id: 12345678,
            app_slug: 'atlas-app-bot',
            human_name: 'X',
            human_email: 'x@example.com',
            human_gh_login: 'x',
        });
        svc.getToken.mockResolvedValueOnce('ghs_installation_token');
        const auth = await buildGitAuth('c1');
        expect(auth).not.toBeNull();
        expect(existsSync(auth!.configDir)).toBe(true);
        cleanupGitConfig(auth!.configPath);
        expect(existsSync(auth!.configDir)).toBe(false);
    });
});
