import { describe, expect, it } from 'vitest';
import { runBulkInstall } from './bulkInstall.js';

describe('runBulkInstall', () => {
    it('installs every id once and reports them all as succeeded', async () => {
        const calls: Array<{ id: string; opts: { agent_id?: string } | undefined }> = [];
        const install = async (id: string, opts?: { agent_id?: string }) => {
            calls.push({ id, opts });
        };

        const result = await runBulkInstall(['agent-coder', 'agent-architect'], install);

        expect(result.succeeded).toEqual(['agent-coder', 'agent-architect']);
        expect(result.failed).toEqual([]);
        expect(calls).toEqual([
            { id: 'agent-coder', opts: undefined },
            { id: 'agent-architect', opts: undefined },
        ]);
    });

    it('keeps installing the rest when one id fails', async () => {
        const install = async (id: string) => {
            if (id === 'agent-bad') throw new Error('boom');
        };

        const result = await runBulkInstall(
            ['agent-coder', 'agent-bad', 'agent-architect'],
            install
        );

        expect(result.succeeded).toEqual(['agent-coder', 'agent-architect']);
        // The reason has to survive — reporting a bare count is what made a
        // real install failure (a pruned cli_models row tripping
        // agents_cli_model_fk) undiagnosable from the UI.
        expect(result.failed).toEqual([{ id: 'agent-bad', status: null, reason: 'boom' }]);
    });

    it('retries a SLUG_TAKEN id once under the server-suggested slug', async () => {
        const calls: Array<{ id: string; opts: { agent_id?: string } | undefined }> = [];
        const install = async (id: string, opts?: { agent_id?: string }) => {
            calls.push({ id, opts });
            // First attempt for the colliding id (no opts) rejects with the
            // structured 409 envelope; the retry under the suggested slug wins.
            if (id === 'agent-coder' && opts === undefined) {
                throw { details: { suggested_id: 'agent-coder-2' } };
            }
        };

        const result = await runBulkInstall(['agent-coder'], install);

        expect(result.succeeded).toEqual(['agent-coder']);
        expect(result.failed).toEqual([]);
        expect(calls).toEqual([
            { id: 'agent-coder', opts: undefined },
            { id: 'agent-coder', opts: { agent_id: 'agent-coder-2' } },
        ]);
    });

    it('marks the id failed when the suggested-slug retry also fails', async () => {
        const install = async (_id: string, opts?: { agent_id?: string }) => {
            if (opts === undefined) throw { details: { suggested_id: 'agent-coder-2' } };
            throw new Error('still taken');
        };

        const result = await runBulkInstall(['agent-coder'], install);

        expect(result.succeeded).toEqual([]);
        expect(result.failed).toEqual([{ id: 'agent-coder', status: null, reason: 'still taken' }]);
    });

    it('returns empty outcome for an empty selection', async () => {
        let called = false;
        const install = async () => {
            called = true;
        };

        const result = await runBulkInstall([], install);

        expect(result).toEqual({ succeeded: [], failed: [] });
        expect(called).toBe(false);
    });

    it('carries the HTTP status and server message off an AtlasApiError-shaped rejection', async () => {
        const install = async () => {
            throw Object.assign(new Error("model 'haiku' is not in the cli_models registry"), {
                status: 400,
            });
        };

        const result = await runBulkInstall(['agent-jira-to-epic'], install);

        expect(result.failed).toEqual([
            {
                id: 'agent-jira-to-epic',
                status: 400,
                reason: "model 'haiku' is not in the cli_models registry",
            },
        ]);
    });
});
