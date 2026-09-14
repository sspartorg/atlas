import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import Knex from 'knex';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent } from '../../tests/_items.js';
import { up, down } from './migrations/032_reviewer_on_fail_to_writer.js';

const PAIRS: Array<[string, string]> = [
    ['agent-po-reviewer', 'agent-po-writer'],
    ['agent-architect-reviewer', 'agent-architect'],
    ['agent-code-reviewer', 'agent-coder'],
    ['agent-qa-reviewer', 'agent-qa-writer'],
    ['agent-automation-reviewer', 'agent-automation'],
];

const knex = Knex({ client: 'pg', connection: process.env['DATABASE_URL'] ?? '', pool: { min: 0, max: 1 } });

afterAll(async () => {
    await knex.destroy();
});

async function onFail(agentId: string): Promise<{ target_agent_id: string; status: string } | undefined> {
    return testDb
        .selectFrom('agent_handoff_rules')
        .select(['target_agent_id', 'status'])
        .where('agent_id', '=', agentId)
        .where('kind', '=', 'on-fail')
        .executeTakeFirst();
}

describe('catalog — reviewer on-fail routes back to the writer', () => {
    it.each(PAIRS)('%s on-fail → %s / ready', (reviewer, writer) => {
        const rules = JSON.parse(
            readFileSync(join(import.meta.dirname, '..', 'marketplace', 'catalog', reviewer, 'handoff_rules.json'), 'utf8'),
        ) as Array<{ target_agent_id: string; kind: string; status: string }>;
        const fail = rules.filter((r) => r.kind === 'on-fail');
        expect(fail).toEqual([{ target_agent_id: writer, kind: 'on-fail', status: 'ready' }]);
    });
});

describe('migration 032 — reviewer on-fail to writer', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-code-reviewer' });
        await insertAgent({ id: 'agent-qa-reviewer' });
        await insertAgent({ id: 'agent-po-writer' });
    });

    it('rewrites rows still on the old default and leaves Owner-customised rows alone', async () => {
        await testDb
            .insertInto('agent_handoff_rules')
            .values([
                { agent_id: 'agent-code-reviewer', kind: 'on-fail', target_agent_id: 'owner', status: 'waiting_for_info' },
                // Owner customised: same target, different status.
                { agent_id: 'agent-qa-reviewer', kind: 'on-fail', target_agent_id: 'owner', status: 'in_review' },
                // Not a reviewer — never touched.
                { agent_id: 'agent-po-writer', kind: 'on-fail', target_agent_id: 'owner', status: 'waiting_for_info' },
            ])
            .execute();

        await up(knex);

        expect(await onFail('agent-code-reviewer')).toEqual({ target_agent_id: 'agent-coder', status: 'ready' });
        expect(await onFail('agent-qa-reviewer')).toEqual({ target_agent_id: 'owner', status: 'in_review' });
        expect(await onFail('agent-po-writer')).toEqual({ target_agent_id: 'owner', status: 'waiting_for_info' });

        await down(knex);

        expect(await onFail('agent-code-reviewer')).toEqual({ target_agent_id: 'owner', status: 'waiting_for_info' });
        expect(await onFail('agent-qa-reviewer')).toEqual({ target_agent_id: 'owner', status: 'in_review' });
    });
});
