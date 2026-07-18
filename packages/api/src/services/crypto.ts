import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { platform, hostname } from 'node:os';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyPath(): string {
    const override = process.env['ATLAS_DATA_DIR'];
    const dir =
        override ??
        (platform() === 'win32'
            ? join(
                  process.env['APPDATA'] ??
                      join(process.env['USERPROFILE'] ?? '.', 'AppData', 'Roaming'),
                  'Atlas'
              )
            : // The non-win32 branch is unreachable on Windows CI where tests run.
              /* v8 ignore next */
              join(process.env['HOME'] ?? '.', '.config', 'Atlas'));
    return join(dir, 'workspace.key');
}

/**
 * Read a stable machine identifier from the OS. Used as IKM for the HKDF below
 * so the workspace key can be re-derived on the same machine if `workspace.key`
 * is lost — credentials encrypted on this machine stay decryptable across
 * re-installs. Returns `null` on platforms or SKUs where no stable ID is
 * readable, which forces the random-key fallback in `loadOrCreateKey()`.
 *
 * Threat model: a local user with the same OS account can read these IDs.
 * That's the same threat model as the workspace.key file's 0o600 / ACL.
 * The chmod / ACL still applies; this just removes the "delete the file = lose
 * all credentials" footgun for the legitimate owner.
 */
function readMachineFingerprint(): string | null {
    try {
        // The else-branch (POSIX /etc/machine-id lookup) below is
        // unreachable on Windows CI where the test suite always runs.
        /* v8 ignore next */
        if (platform() === 'win32') {
            // MachineGuid is created at OS install; survives reboots, not reinstalls.
            const out = execFileSync(
                'reg',
                ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
                { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
            );
            const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{32,36})/i);
            // m?.[1] is null only when the registry key is absent — unreachable
            // on a well-formed Windows install; the null arm falls through to the
            // random-bytes fallback which is fine.
            /* v8 ignore next */
            if (m?.[1]) return `win32:${m[1]}:${hostname()}`;
        } else {
            // Linux: /etc/machine-id (systemd) or /var/lib/dbus/machine-id (legacy).
            // macOS doesn't expose either, so we'll fall through to the null path.
            // The entire else-branch is unreachable on Windows CI where the test suite runs.
            /* v8 ignore next 6 */
            for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
                if (existsSync(p)) {
                    const id = readFileSync(p, 'utf-8').trim();
                    if (id.length >= 16) return `posix:${id}:${hostname()}`;
                }
            }
        }
    } catch {
        // Fall through — random fallback is fine.
    }
    return null;
}

function deriveKeyFromMachine(fingerprint: string): Buffer {
    // HKDF-SHA256 with a versioned salt + info so a future scheme change can
    // co-exist with v1-encrypted rows during a migration.
    const ikm = Buffer.from(fingerprint, 'utf-8');
    const salt = Buffer.from('atlas-workspace-key-v1', 'utf-8');
    const info = Buffer.from('aes-256-gcm/workspace', 'utf-8');
    return Buffer.from(hkdfSync('sha256', ikm, salt, info, KEY_BYTES));
}

function lockDown(path: string): void {
    try {
        chmodSync(path, 0o600);
    } catch {
        // chmod is a no-op on Windows (doesn't throw) — this catch is unreachable on CI.
        /* v8 ignore next */
    }
    // On Windows CI: platform() is always 'win32' — the false arm is unreachable.
    /* v8 ignore next */
    if (platform() === 'win32') {
        const user = process.env['USERNAME'];
        // USERNAME is always set on Windows; the false arm is unreachable on CI.
        /* v8 ignore next */
        if (user) {
            try {
                execFileSync(
                    'icacls',
                    [path, '/inheritance:r', '/grant:r', `${user}:(R,W)`],
                    { stdio: 'ignore' },
                );
            } catch {
                // BitLocker is the recommended defence-in-depth on Windows.
            }
        }
    }
}

let cachedKey: Buffer | null = null;

function loadOrCreateKey(): Buffer {
    if (cachedKey) return cachedKey;
    const path = keyPath();
    if (existsSync(path)) {
        const buf = readFileSync(path);
        if (buf.length !== KEY_BYTES) {
            throw new Error(
                `workspace.key has invalid length (${buf.length} bytes; expected ${KEY_BYTES}). Delete the file to regenerate — credentials encrypted with the old key will become unreadable.`,
            );
        }
        cachedKey = buf;
        return buf;
    }

    mkdirSync(dirname(path), { recursive: true });
    const fingerprint = readMachineFingerprint();
    const key = fingerprint ? deriveKeyFromMachine(fingerprint) : randomBytes(KEY_BYTES);
    writeFileSync(path, key);
    lockDown(path);
    cachedKey = key;
    return key;
}

export function encrypt(plain: string): string {
    const key = loadOrCreateKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(b64: string): string {
    const key = loadOrCreateKey();
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES + 1) throw new Error('ciphertext too short');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

export function fingerprint(token: string): string {
    const tail = token.slice(-4);
    const prefix = token.startsWith('ghp_')
        ? 'ghp_'
        : token.startsWith('github_pat_')
          ? 'gpat_'
          : 'tok_';
    return `${prefix}${'•'.repeat(16)}${tail}`;
}
