import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Use a dedicated temp dir for the workspace.key file each test run.
const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-test-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

import { encrypt, decrypt, fingerprint } from './crypto.js';
import type * as NodeChildProcess from 'node:child_process';

describe('crypto', () => {
    describe('encrypt / decrypt round-trip', () => {
        it('decrypts back to the original plaintext', () => {
            const plain = 'hello-world-secret';
            const cipher = encrypt(plain);
            expect(cipher).not.toBe(plain);
            expect(decrypt(cipher)).toBe(plain);
        });

        it('produces a different ciphertext each call (random IV)', () => {
            const a = encrypt('same');
            const b = encrypt('same');
            expect(a).not.toBe(b);
        });

        it('rejects ciphertext that is too short', () => {
            expect(() => decrypt('aaaa')).toThrowError(/too short/);
        });

        it('rejects tampered ciphertext via GCM auth tag', () => {
            const good = encrypt('msg');
            // Flip a byte deep inside the payload (after IV+tag)
            const buf = Buffer.from(good, 'base64');
            buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
            expect(() => decrypt(buf.toString('base64'))).toThrow();
        });
    });

    describe('keyPath fallback', () => {
        // CR-EXTRA — when APPDATA itself is unset on win32, keyPath() falls
        // back to `${USERPROFILE}/AppData/Roaming`. Covers the nested `??`
        // fallback branch that the APPDATA-set test above never exercises.
        it('falls back to USERPROFILE/AppData/Roaming when APPDATA is unset (win32)', async () => {
            const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-userprofile-'));
            const origAtlasDir = process.env['ATLAS_DATA_DIR'];
            const origAppdata = process.env['APPDATA'];
            const origUserprofile = process.env['USERPROFILE'];
            delete process.env['ATLAS_DATA_DIR'];
            delete process.env['APPDATA'];
            process.env['USERPROFILE'] = tmpHome;
            try {
                vi.resetModules();
                const mod = await import('./crypto.js');
                const cipher = mod.encrypt('payload');
                expect(mod.decrypt(cipher)).toBe('payload');
                expect(
                    fs.existsSync(
                        path.join(tmpHome, 'AppData', 'Roaming', 'Atlas', 'workspace.key'),
                    ),
                ).toBe(true);
            } finally {
                if (origAtlasDir !== undefined) process.env['ATLAS_DATA_DIR'] = origAtlasDir;
                if (origAppdata !== undefined) process.env['APPDATA'] = origAppdata;
                else delete process.env['APPDATA'];
                if (origUserprofile !== undefined) process.env['USERPROFILE'] = origUserprofile;
                else delete process.env['USERPROFILE'];
            }
        });

        // CR-EXTRA — when both APPDATA and USERPROFILE are unset, keyPath()
        // falls all the way back to '.' (cwd-relative AppData/Roaming). Runs
        // inside a temp cwd (via chdir) so it never touches the real cwd.
        it('falls back to "." when both APPDATA and USERPROFILE are unset (win32)', async () => {
            const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-cwd-'));
            const origCwd = process.cwd();
            const origAtlasDir = process.env['ATLAS_DATA_DIR'];
            const origAppdata = process.env['APPDATA'];
            const origUserprofile = process.env['USERPROFILE'];
            delete process.env['ATLAS_DATA_DIR'];
            delete process.env['APPDATA'];
            delete process.env['USERPROFILE'];
            process.chdir(tmpCwd);
            try {
                vi.resetModules();
                const mod = await import('./crypto.js');
                const cipher = mod.encrypt('payload');
                expect(mod.decrypt(cipher)).toBe('payload');
                expect(
                    fs.existsSync(
                        path.join(tmpCwd, 'AppData', 'Roaming', 'Atlas', 'workspace.key'),
                    ),
                ).toBe(true);
            } finally {
                process.chdir(origCwd);
                if (origAtlasDir !== undefined) process.env['ATLAS_DATA_DIR'] = origAtlasDir;
                if (origAppdata !== undefined) process.env['APPDATA'] = origAppdata;
                if (origUserprofile !== undefined) process.env['USERPROFILE'] = origUserprofile;
            }
        });

        it('encrypts/decrypts even without ATLAS_DATA_DIR (falls back to APPDATA / HOME)', async () => {
            // Reset module cache and re-import crypto with no ATLAS_DATA_DIR override.
            // The fallback path resolves under a temp home so we don't pollute the
            // real user profile.
            const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-home-'));
            const origAtlasDir = process.env['ATLAS_DATA_DIR'];
            const origAppdata = process.env['APPDATA'];
            const origHome = process.env['HOME'];
            const origUserprofile = process.env['USERPROFILE'];
            delete process.env['ATLAS_DATA_DIR'];
            process.env['APPDATA'] = tmpHome;
            process.env['HOME'] = tmpHome;
            process.env['USERPROFILE'] = tmpHome;
            try {
                vi.resetModules();
                const mod = await import('./crypto.js');
                const cipher = mod.encrypt('payload');
                expect(mod.decrypt(cipher)).toBe('payload');
            } finally {
                if (origAtlasDir !== undefined) process.env['ATLAS_DATA_DIR'] = origAtlasDir;
                if (origAppdata !== undefined) process.env['APPDATA'] = origAppdata;
                if (origHome !== undefined) process.env['HOME'] = origHome;
                else delete process.env['HOME'];
                if (origUserprofile !== undefined) process.env['USERPROFILE'] = origUserprofile;
                else delete process.env['USERPROFILE'];
            }
        });
    });

    describe('fingerprint', () => {
        it('prefixes ghp_ tokens with ghp_ + last 4 chars', () => {
            expect(fingerprint('ghp_aaaaaaaaaaaaaaaa1234')).toBe(
                `ghp_${'•'.repeat(16)}1234`
            );
        });

        it('prefixes github_pat_ tokens with gpat_', () => {
            expect(fingerprint('github_pat_xxxx9999')).toBe(`gpat_${'•'.repeat(16)}9999`);
        });

        it('falls back to tok_ for unknown prefixes', () => {
            expect(fingerprint('abc1234567xxxx')).toBe(`tok_${'•'.repeat(16)}xxxx`);
        });
    });

    describe('loadOrCreateKey edge cases', () => {
        it('throws when workspace.key has the wrong length', async () => {
            const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-bad-'));
            // Write a 16-byte (too-short) key file.
            fs.writeFileSync(path.join(badDir, 'workspace.key'), Buffer.alloc(16));
            const orig = process.env['ATLAS_DATA_DIR'];
            process.env['ATLAS_DATA_DIR'] = badDir;
            try {
                vi.resetModules();
                const mod = await import('./crypto.js');
                expect(() => mod.encrypt('x')).toThrow(/invalid length/);
            } finally {
                if (orig !== undefined) process.env['ATLAS_DATA_DIR'] = orig;
            }
        });

        it('decrypt rejects a too-short ciphertext (length<IV+TAG+1)', () => {
            // 28 bytes is below IV(12)+TAG(16)+1 = 29. Generate a 20-byte base64.
            const tooShort = Buffer.alloc(20).toString('base64');
            expect(() => decrypt(tooShort)).toThrow(/too short/);
        });

        // CR-EXTRA — loads a pre-existing, correctly-sized workspace.key from
        // disk instead of generating a new one. Every other test in this file
        // starts from an empty dir (create-path only) or a too-short key
        // (throw path); this exercises the "existing valid key" branch of
        // `buf.length !== KEY_BYTES`.
        it('loads a pre-existing correctly-sized workspace.key from disk', async () => {
            const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-good-'));
            const validKey = Buffer.alloc(32, 7);
            fs.writeFileSync(path.join(goodDir, 'workspace.key'), validKey);
            const orig = process.env['ATLAS_DATA_DIR'];
            process.env['ATLAS_DATA_DIR'] = goodDir;
            try {
                vi.resetModules();
                const mod = await import('./crypto.js');
                const cipher = mod.encrypt('reuse-existing-key');
                expect(mod.decrypt(cipher)).toBe('reuse-existing-key');
                // The on-disk key must be unchanged (loaded, not regenerated).
                expect(fs.readFileSync(path.join(goodDir, 'workspace.key'))).toEqual(validKey);
            } finally {
                if (orig !== undefined) process.env['ATLAS_DATA_DIR'] = orig;
            }
        });

        // CR-EXTRA — when the machine fingerprint can't be read at all (e.g.
        // `reg query` fails), readMachineFingerprint() falls through to
        // `return null`, and loadOrCreateKey() falls back to
        // `randomBytes(KEY_BYTES)` instead of deriving from the fingerprint.
        // Every other test runs on real Windows CI where the registry lookup
        // always succeeds, so this is the only way to reach that fallback.
        it('falls back to a random key when the machine fingerprint is unreadable', async () => {
            const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-nofingerprint-'));
            const orig = process.env['ATLAS_DATA_DIR'];
            process.env['ATLAS_DATA_DIR'] = freshDir;
            vi.resetModules();
            vi.doMock('node:child_process', async () => {
                const actual = await vi.importActual<typeof NodeChildProcess>(
                    'node:child_process',
                );
                return {
                    ...actual,
                    execFileSync: () => {
                        throw new Error('reg query unavailable in this test');
                    },
                };
            });
            try {
                const mod = await import('./crypto.js');
                const cipher = mod.encrypt('random-key-fallback');
                expect(mod.decrypt(cipher)).toBe('random-key-fallback');
                expect(
                    fs.existsSync(path.join(freshDir, 'workspace.key')),
                ).toBe(true);
            } finally {
                vi.doUnmock('node:child_process');
                if (orig !== undefined) process.env['ATLAS_DATA_DIR'] = orig;
                vi.resetModules();
            }
        });
    });
});
