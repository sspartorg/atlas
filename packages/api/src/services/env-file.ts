import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IEnvVar } from '@atlas/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vars exposed on the Environment tab. Anything else in .env is preserved on
// write but invisible to the UI — keeps the page focused and avoids accidental
// edits to things like NODE_ENV or PATH overrides.
//
// External-notification credentials (bot tokens, chat IDs, webhook URLs) are
// intentionally NOT env vars — Settings → Notifications is the single source
// of truth and stores them encrypted in the settings table. Surfacing them
// here too would duplicate state and confuse "where is my token".
export const KNOWN_ENV_VARS: ReadonlyArray<Omit<IEnvVar, 'value'>> = [
    {
        key: 'ATLAS_LOG_LEVEL',
        secret: false,
        // P6: live-applied. PATCH /api/settings/env detects edits to this
        // key and calls applyRuntimeLogLevel() which sets the running Pino
        // logger's `.level` — the next log line honours the new threshold
        // without a restart. The env-file write keeps the change across
        // boots.
        restart_required: false,
        description: 'One of: trace · debug · info · warn · error · fatal.',
    },
    {
        key: 'ATLAS_FEEDBACK_URL',
        secret: false,
        // The web client reads this via /api/settings/env on every Sidenav
        // mount, and PATCH updates process.env immediately — no restart.
        restart_required: false,
        description:
            'Where the in-app "Report a bug" link points (sidenav footer + ' +
            'Settings → Help & About). Default: ' +
            'https://github.com/sspartorg/atlas/issues. Also accepts ' +
            'mailto:you@example.com. Leave blank to hide the link.',
    },
];

function envFilePath(): string {
    // dist/services/env-file.js → ../../.env, src/services/env-file.ts → ../../.env (tsx)
    return path.resolve(__dirname, '..', '..', '.env');
}

// Defense in depth: refuse writes to files outside the API package, even if
// __dirname is somehow misresolved during a future refactor.
function assertSafePath(p: string): void {
    const pkgRoot = path.resolve(__dirname, '..', '..');
    if (!p.startsWith(pkgRoot + path.sep) && p !== path.join(pkgRoot, '.env')) {
        throw new Error(`env file path escapes API package root: ${p}`);
    }
}

/**
 * Replace assignments for `updates` in `source`. Preserves comments, blank
 * lines, and the existing order. Keys not yet present are appended at the
 * end with a blank line separator.
 *
 * Quoting: if the existing line wrapped its value in single or double quotes,
 * the new value uses the same quote style with naive escaping. Otherwise it
 * writes bare. Multi-line values are not supported (rewrites the whole line).
 */
export function rewriteEnv(source: string, updates: Array<{ key: string; value: string }>): string {
    const updatesMap = new Map(updates.map((u) => [u.key, u.value]));
    const seen = new Set<string>();
    const lines = source.split(/\r?\n/);
    const out: string[] = [];

    const ASSIGN_RE = /^(\s*)([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

    for (const line of lines) {
        const stripped = line.trimStart();
        if (stripped.startsWith('#') || stripped === '') {
            out.push(line);
            continue;
        }
        const m = ASSIGN_RE.exec(line);
        if (!m) {
            out.push(line);
            continue;
        }
        const [, indent, key, rawValue] = m;
        // `!key` is a defensive null-check: the regex requires a capture group
        // match so `key` is always a non-empty string when `m` is non-null.
        /* v8 ignore next */
        if (!key || !updatesMap.has(key)) {
            out.push(line);
            continue;
        }
        seen.add(key);
        const nextValue = updatesMap.get(key)!;
        // `rawValue` and `indent` come from `(.*)` and `(\s*)` capture groups that
        // always match; the `?? ''` fallback arms are unreachable when the regex fires.
        /* v8 ignore next */
        const quote = detectQuote(rawValue ?? '');
        /* v8 ignore next */
        out.push(`${indent ?? ''}${key}=${formatValue(nextValue, quote)}`);
    }

    // Append keys that didn't exist in the file.
    const tail: string[] = [];
    for (const [key, value] of updatesMap) {
        if (seen.has(key)) continue;
        tail.push(`${key}=${formatValue(value, 'auto')}`);
    }
    if (tail.length > 0) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        out.push(...tail);
    }

    return out.join('\n');
}

type Quote = '"' | "'" | 'bare' | 'auto';

function detectQuote(raw: string): Quote {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return '"';
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) return "'";
    return 'bare';
}

function formatValue(value: string, quote: Quote): string {
    if (quote === 'auto') {
        // Default writer: quote if the value contains whitespace, =, # or quotes.
        return /[\s=#"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
    }
    if (quote === '"') return `"${value.replace(/"/g, '\\"')}"`;
    if (quote === "'") return `'${value.replace(/'/g, "\\'")}'`;
    return value;
}

// Parse for read. Mirrors rewriteEnv's assignment regex; comments + blanks
// are dropped, and quoted values are unwrapped.
export function parseEnv(source: string): Map<string, string> {
    const out = new Map<string, string>();
    const ASSIGN_RE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;
    for (const line of source.split(/\r?\n/)) {
        const stripped = line.trimStart();
        if (stripped.startsWith('#') || stripped === '') continue;
        const m = ASSIGN_RE.exec(line);
        if (!m) continue;
        const [, key, rawValue] = m;
        // `!key` is a defensive null-check: the regex requires a non-empty
        // capture group so `key` is always a string when `m` is non-null.
        /* v8 ignore next */
        if (!key) continue;
        // `rawValue` comes from `(.*)` which always matches; the `?? ''` arm is unreachable.
        /* v8 ignore next */
        out.set(key, unquote(rawValue ?? ''));
    }
    return out;
}

function unquote(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/\\'/g, "'");
    }
    return trimmed;
}

export const envFileService = {
    read(): IEnvVar[] {
        const filePath = envFilePath();
        let source = '';
        try {
            source = fs.readFileSync(filePath, 'utf8');
        } catch {
            // Missing .env is fine — return all keys with empty values so the UI
            // can render the row and the user can create them via Save Changes.
        }
        // Live process.env wins over file values for read display. This matches
        // what the running server is actually using; the disk value may have been
        // edited externally without a restart.
        const file = parseEnv(source);
        return KNOWN_ENV_VARS.map((meta) => ({
            ...meta,
            value: process.env[meta.key] ?? file.get(meta.key) ?? '',
        }));
    },

    write(updates: Array<{ key: string; value: string }>): void {
        const filePath = envFilePath();
        assertSafePath(filePath);
        let source = '';
        try {
            source = fs.readFileSync(filePath, 'utf8');
        } catch {
            // Will be created.
        }
        const next = rewriteEnv(source, updates);
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, next, 'utf8');
        fs.renameSync(tmp, filePath);
    },
};
