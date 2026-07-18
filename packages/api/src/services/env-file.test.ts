import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { parseEnv, rewriteEnv, envFileService, KNOWN_ENV_VARS } from './env-file.js';

describe('rewriteEnv', () => {
    it('replaces an existing bare value in place', () => {
        const src = `ATLAS_LOG_LEVEL=info\nGIT_AUTHOR_NAME=Atlas Agents\n`;
        const out = rewriteEnv(src, [{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);
        expect(out).toContain('ATLAS_LOG_LEVEL=debug');
        expect(out).toContain('GIT_AUTHOR_NAME=Atlas Agents');
    });

    it('preserves comments and blank lines', () => {
        const src = `# log level\nATLAS_LOG_LEVEL=info\n\n# git author\nGIT_AUTHOR_NAME=Old Name\n`;
        const out = rewriteEnv(src, [{ key: 'GIT_AUTHOR_NAME', value: 'New Name' }]);
        expect(out.split('\n')).toEqual([
            '# log level',
            'ATLAS_LOG_LEVEL=info',
            '',
            '# git author',
            'GIT_AUTHOR_NAME=New Name',
            '',
        ]);
    });

    it('keeps double-quoted style when the existing line was quoted', () => {
        const src = `ATLAS_MCP_TOKEN="old token"\n`;
        const out = rewriteEnv(src, [{ key: 'ATLAS_MCP_TOKEN', value: 'new token' }]);
        expect(out).toContain('ATLAS_MCP_TOKEN="new token"');
    });

    it('appends a new key at the end with a blank separator', () => {
        const src = `ATLAS_LOG_LEVEL=info`;
        const out = rewriteEnv(src, [{ key: 'GIT_AUTHOR_NAME', value: 'New Author' }]);
        expect(out).toMatch(/ATLAS_LOG_LEVEL=info\n\nGIT_AUTHOR_NAME="New Author"$/);
    });

    it('does not touch unrelated rows', () => {
        const src = `NODE_ENV=production\nATLAS_LOG_LEVEL=info\n`;
        const out = rewriteEnv(src, [{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);
        expect(out).toContain('NODE_ENV=production');
    });
});

describe('parseEnv', () => {
    it('parses bare and quoted values', () => {
        const map = parseEnv(`A=1\nB="two words"\nC='single'\n# comment\n\nD=`);
        expect(map.get('A')).toBe('1');
        expect(map.get('B')).toBe('two words');
        expect(map.get('C')).toBe('single');
        expect(map.get('D')).toBe('');
    });
});

describe('envFileService.read', () => {
    it('returns rows for all KNOWN_ENV_VARS with values resolved from process.env or fallback', () => {
        const list = envFileService.read();
        expect(list.length).toBe(KNOWN_ENV_VARS.length);
        const logLevel = list.find((v) => v.key === 'ATLAS_LOG_LEVEL');
        expect(logLevel).toBeDefined();
        expect(typeof logLevel!.value).toBe('string');
        // P6: live-applied via POST /api/settings/log-level, so no restart needed.
        expect(logLevel!.restart_required).toBe(false);
    });

    it('prefers process.env over disk values', () => {
        const prev = process.env['ATLAS_LOG_LEVEL'];
        process.env['ATLAS_LOG_LEVEL'] = 'debug-from-env';
        try {
            const list = envFileService.read();
            const row = list.find((v) => v.key === 'ATLAS_LOG_LEVEL');
            expect(row!.value).toBe('debug-from-env');
        } finally {
            if (prev === undefined) delete process.env['ATLAS_LOG_LEVEL'];
            else process.env['ATLAS_LOG_LEVEL'] = prev;
        }
    });
});

describe('rewriteEnv edge cases', () => {
    it('writes single-quoted style when the existing line was single-quoted', () => {
        const src = `KEY='old'\n`;
        const out = rewriteEnv(src, [{ key: 'KEY', value: 'new' }]);
        expect(out).toContain(`KEY='new'`);
    });

    it('preserves leading whitespace (indent) on the rewritten line', () => {
        const src = `  KEY=old\n`;
        const out = rewriteEnv(src, [{ key: 'KEY', value: 'new' }]);
        expect(out).toContain(`  KEY=new`);
    });

    it('escapes embedded double quotes when writing a quoted value', () => {
        const src = `KEY="old"\n`;
        const out = rewriteEnv(src, [{ key: 'KEY', value: 'has "quote"' }]);
        expect(out).toContain(String.raw`KEY="has \"quote\""`);
    });

    it('writes bare value when no whitespace/special chars in auto mode', () => {
        const src = ``;
        const out = rewriteEnv(src, [{ key: 'KEY', value: 'simple' }]);
        expect(out).toContain('KEY=simple');
    });
});

describe('rewriteEnv — empty source appends key via tail path', () => {
    it('appends a key to empty source (exercises out.length>0 && last!="" branch)', () => {
        // source='' splits to [''], a single empty string line.
        // After the loop, out=[''] (last element IS ''), so the
        // `out[out.length-1] !== ''` guard is false → no extra blank separator.
        // The key is appended in tail. Result: '\nKEY=val'.
        const out = rewriteEnv('', [{ key: 'KEY', value: 'val' }]);
        expect(out).toContain('KEY=val');
        // The conditional `out[out.length - 1] !== ''` evaluated to false (no extra blank added).
    });
});

describe('formatValue bare (quote=bare) branch', () => {
    it('returns the bare value when the existing line has no quotes (detectQuote → bare)', () => {
        // The test for "replaces an existing bare value" exercises detectQuote→bare
        // and formatValue(value, 'bare'). Here we verify the result explicitly.
        const src = 'ATLAS_LOG_LEVEL=info\n';
        const out = rewriteEnv(src, [{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);
        // bare mode: no quotes around 'debug'
        expect(out).toContain('ATLAS_LOG_LEVEL=debug');
        expect(out).not.toContain('"debug"');
        expect(out).not.toContain("'debug'");
    });
});

describe('formatValue auto — whitespace triggers quoting', () => {
    it('auto-quotes when value contains a space', () => {
        // rewriteEnv with a key not in the source triggers the `tail` append path
        // which calls formatValue(value, 'auto'). Value with a space hits the
        // /[\s=#"']/.test(value) true branch → double-quoted.
        const out = rewriteEnv('EXISTING=1', [{ key: 'KEY', value: 'has space' }]);
        expect(out).toContain('KEY="has space"');
    });
});

describe('unquote — partial-quote strings fall through to bare', () => {
    it('returns trimmed value for a string that starts with quote but does not end with it', () => {
        // parseEnv → unquote: trimmed starts with " but does not end with " →
        // first if-branch false. Same for single-quote second branch. Falls
        // through to `return trimmed`.
        const map = parseEnv('KEY="only-open\n');
        // The raw value after = is '"only-open', which doesn't end with '"'
        // so unquote returns it trimmed: '"only-open'
        expect(map.get('KEY')).toBe('"only-open');
    });
});

describe('envFileService.read — file provides value when process.env is absent', () => {
    it('falls back to file.get() when process.env key is not set', () => {
        // Ensure the env var is NOT set so the `process.env[meta.key] ?? file.get(meta.key)`
        // left side is undefined and the right side fires.
        const key = 'ATLAS_FEEDBACK_URL';
        const prev = process.env[key];
        delete process.env[key];
        const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(`${key}=http://test.example.com\n` as never);
        try {
            const list = envFileService.read();
            const row = list.find((v) => v.key === key);
            expect(row!.value).toBe('http://test.example.com');
        } finally {
            if (prev !== undefined) process.env[key] = prev;
            readSpy.mockRestore();
        }
    });
});

// A5 / 05-coverage-gap — envFileService.write exercises file-doesn't-exist
// AND file-exists branches via mocked fs methods. The real implementation
// writes the API package's `.env` at the project root, which would clobber
// the developer's working file in a real test, so this stays in mock-land.
//
// env-file.ts imports `fs` from 'fs' (default export). vi.spyOn on the
// imported `node:fs` default reaches the same module instance because
// node's module loader resolves both to the same target — vitest's spy
// patches the descriptor on the namespace object that both imports share.
describe('rewriteEnv — line fails ASSIGN_RE (no `=` / non-key-shaped line)', () => {
    it('passes through a non-blank, non-comment line that does not match the assignment regex', () => {
        // "export KEY" has no `=` at all, so ASSIGN_RE.exec returns null and the
        // `if (!m)` branch fires — the line is pushed through unchanged.
        const src = `export KEY\nATLAS_LOG_LEVEL=info\n`;
        const out = rewriteEnv(src, [{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);
        expect(out).toContain('export KEY');
        expect(out).toContain('ATLAS_LOG_LEVEL=debug');
    });
});

describe('parseEnv — line fails ASSIGN_RE (no `=` / non-key-shaped line)', () => {
    it('skips a non-blank, non-comment line that does not match the assignment regex', () => {
        const map = parseEnv(`export KEY\nA=1\n`);
        expect(map.get('A')).toBe('1');
        expect(map.has('export KEY')).toBe(false);
        expect(map.size).toBe(1);
    });
});

describe('envFileService.write — fs-mocked write paths (A5)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('writes updates when the .env file is missing (catch arm: empty source)', () => {
        // Simulate ENOENT on initial read; the write path falls back to
        // an empty source and lets `rewriteEnv` append at the end.
        const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        });
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as never);
        const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((() => undefined) as never);

        envFileService.write([{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);

        expect(readSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const [tmpPath, body] = writeSpy.mock.calls[0]!;
        expect(String(tmpPath)).toMatch(/\.env\.tmp$/);
        expect(String(body)).toContain('ATLAS_LOG_LEVEL=debug');
        expect(renameSpy).toHaveBeenCalledTimes(1);
    });

    it('writes updates when the .env file exists (replaces matching line in place)', () => {
        const existing = 'ATLAS_LOG_LEVEL=info\nOTHER=keep\n';
        const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(existing as never);
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as never);
        const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((() => undefined) as never);

        envFileService.write([{ key: 'ATLAS_LOG_LEVEL', value: 'debug' }]);

        expect(readSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const [, body] = writeSpy.mock.calls[0]!;
        expect(String(body)).toContain('ATLAS_LOG_LEVEL=debug');
        // Untouched row preserved.
        expect(String(body)).toContain('OTHER=keep');
        expect(renameSpy).toHaveBeenCalledTimes(1);
    });
});
