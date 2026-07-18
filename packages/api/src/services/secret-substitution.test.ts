import { describe, expect, it } from 'vitest';
import {
    mergeSecrets,
    substitute,
    UnknownSecretError,
} from './secret-substitution.js';

describe('substitute', () => {
    it('replaces a single ${variable.KEY} occurrence', () => {
        const vars = new Map([['NAME', 'atlas']]);
        expect(substitute('hello ${variable.NAME}', vars)).toBe('hello atlas');
    });

    it('replaces multiple occurrences in one template', () => {
        const vars = new Map([
            ['HOST', 'localhost'],
            ['PORT', '4000'],
        ]);
        expect(substitute('http://${variable.HOST}:${variable.PORT}/api', vars)).toBe(
            'http://localhost:4000/api',
        );
    });

    it('handles adjacent placeholders without separator', () => {
        const vars = new Map([
            ['A', 'foo'],
            ['B', 'bar'],
        ]);
        expect(substitute('${variable.A}${variable.B}', vars)).toBe('foobar');
    });

    it('substitutes the same key multiple times', () => {
        const vars = new Map([['X', 'hi']]);
        expect(substitute('${variable.X}-${variable.X}-${variable.X}', vars)).toBe('hi-hi-hi');
    });

    it('throws UnknownSecretError naming the missing key', () => {
        const vars = new Map([['KNOWN', 'ok']]);
        try {
            substitute('${variable.MISSING}', vars);
            throw new Error('expected substitute to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(UnknownSecretError);
            expect((err as UnknownSecretError).key).toBe('MISSING');
            expect((err as Error).message).toContain('MISSING');
        }
    });

    it('preserves multi-line values verbatim', () => {
        const vars = new Map([['CERT', '-----BEGIN-----\nline1\nline2\n-----END-----']]);
        const out = substitute('cert:\n${variable.CERT}\n', vars);
        expect(out).toBe('cert:\n-----BEGIN-----\nline1\nline2\n-----END-----\n');
    });

    it('leaves non-matching ${...} expressions literal', () => {
        // Bare ${X}, ${var.X}, ${variable.}, ${variable.123} — none match
        // the engine's pattern and should pass through unchanged.
        const vars = new Map<string, string>();
        const input =
            'shell var $X, dollar-brace ${X}, wrong-ns ${var.X}, empty ${variable.}, leading-digit ${variable.1bad}';
        expect(substitute(input, vars)).toBe(input);
    });

    it('returns empty template unchanged', () => {
        expect(substitute('', new Map())).toBe('');
    });

    it('accepts identifier keys with underscores and digits after the first char', () => {
        const vars = new Map([['MY_VAR_2', 'ok']]);
        expect(substitute('${variable.MY_VAR_2}', vars)).toBe('ok');
    });
});

describe('mergeSecrets', () => {
    it('merges environment and project secrets into one map', () => {
        const env = new Map([['SHARED', 'env-val']]);
        const project = new Map([['LOCAL', 'project-val']]);
        const merged = mergeSecrets(env, project);
        expect(merged.get('SHARED')).toBe('env-val');
        expect(merged.get('LOCAL')).toBe('project-val');
    });

    it('lets project values override environment values on key collision', () => {
        const env = new Map([['DUPE', 'from-env']]);
        const project = new Map([['DUPE', 'from-project']]);
        expect(mergeSecrets(env, project).get('DUPE')).toBe('from-project');
    });

    it('returns an empty map when both inputs are empty', () => {
        expect(mergeSecrets(new Map(), new Map()).size).toBe(0);
    });

    it('handles undefined inputs as empty', () => {
        const env = new Map([['A', '1']]);
        expect(mergeSecrets(env, undefined).get('A')).toBe('1');
        expect(mergeSecrets(undefined, env).get('A')).toBe('1');
        expect(mergeSecrets(undefined, undefined).size).toBe(0);
    });
});
