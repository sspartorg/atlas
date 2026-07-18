import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    applyOnFailHandoff,
    applyOnPassHandoff,
    resolveHandoffAssignee,
} from './agent-handoff.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// 2026-05-31 — Post-handoff-realignment, every SDLC agent has exactly
// ONE rule per kind. The fan-out resolver + `[QA]` title partitioning
// machinery was retired in the same pass — PO Reviewer's child
// dispatch is now a prompt-driven MCP loop, not a data-driven fan-out.
// This test file follows: single-rule path only, plus the new
// "applyOnPassHandoff writes status from the rule" contract.

async function seedAgents(): Promise<void> {
    const base = {
        cli: 'claude' as const,
        model: 'claude-opus-4-7',
        framework: 'claude-code',
        prompt_md: '',
        prompt_version: 1,
        handoff_prompt_md: '',
        status: 'active' as const,
        accent_color: '#7AE0C7',
        sort_order: 0,
        description: '',
        schedule_hours: 0,
        concurrent_runs: 1,
        glyph: '',
    };
    // Workstream #4 — cli_models row needed for the agents_cli_model_fk
    // constraint to accept the agent rows below. truncateAll wipes
    // cli_models for test isolation; we restore the one row each test
    // here needs.
    await testDb
        .insertInto('cli_models')
        .values({
            id: 'test-cli-claude-claude-opus-4-7',
            cli: 'claude',
            model_name: 'claude-opus-4-7',
            note: null,
            sort_order: 0,
        })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
    await testDb
        .insertInto('agents')
        .values([
            { id: 'agent-test-a', name: 'A', category: 'software-dev', ...base },
            { id: 'agent-test-b', name: 'B', category: 'software-dev', ...base },
            { id: 'agent-test-c', name: 'C', category: 'software-dev', ...base },
        ])
        .execute();
}

async function seedProject(): Promise<void> {
    await testDb
        .insertInto('projects')
        .values({
            id: 'proj-test',
            name: 'Test Project',
            git_path: '',
            issue_key_prefix: 'TST',
        })
        .execute();
}

async function seedEpic(epicId: string): Promise<void> {
    await testDb
        .insertInto('items')
        .values({
            id: epicId,
            project_id: 'proj-test',
            type: 'epic',
            title: 'Parent epic',
            description: '',
            status: 'in_progress',
            parent_id: null,
            parent_type: null,
        })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await seedAgents();
    await seedProject();
});

afterAll(async () => {
    await closeTestDb();
});

// ---------------------------------------------------------------------------
// resolveHandoffAssignee — single rule lookup, returns target + status.
// ---------------------------------------------------------------------------

describe('resolveHandoffAssignee', () => {
    it('returns the on-pass target + status when a matching rule exists', async () => {
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'agent-test-b',
                kind: 'on-pass',
                status: 'ready',
            })
            .execute();
        expect(await resolveHandoffAssignee('agent-test-a', 'on-pass')).toEqual({
            assigneeId: 'agent-test-b',
            status: 'ready',
        });
    });

    it('returns the on-fail target + status when a matching rule exists', async () => {
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'owner',
                kind: 'on-fail',
                status: 'waiting_for_info',
            })
            .execute();
        expect(await resolveHandoffAssignee('agent-test-a', 'on-fail')).toEqual({
            assigneeId: null,
            status: 'waiting_for_info',
        });
    });

    it('returns null when no rule exists for the agent + kind', async () => {
        expect(await resolveHandoffAssignee('agent-test-a', 'on-pass')).toBeNull();
    });

    it('resolves the "owner" sentinel to null assigneeId', async () => {
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'owner',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();
        expect(await resolveHandoffAssignee('agent-test-a', 'on-pass')).toEqual({
            assigneeId: null,
            status: 'in_review',
        });
    });

    it('keys on (agent_id, kind) and does not return cross-agent rules', async () => {
        await testDb
            .insertInto('agent_handoff_rules')
            .values([
                {
                    agent_id: 'agent-test-a',
                    target_agent_id: 'agent-test-b',
                    kind: 'on-pass',
                    status: 'ready',
                },
                {
                    agent_id: 'agent-test-b',
                    target_agent_id: 'agent-test-c',
                    kind: 'on-pass',
                    status: 'ready',
                },
            ])
            .execute();
        expect(await resolveHandoffAssignee('agent-test-a', 'on-pass')).toMatchObject({
            assigneeId: 'agent-test-b',
        });
        expect(await resolveHandoffAssignee('agent-test-b', 'on-pass')).toMatchObject({
            assigneeId: 'agent-test-c',
        });
    });
});

// ---------------------------------------------------------------------------
// applyOnPassHandoff — writes BOTH assignee and status from the rule.
// ---------------------------------------------------------------------------

describe('applyOnPassHandoff', () => {
    it('returns empty plan and writes nothing when no rule matches', async () => {
        await seedEpic('epic-1');
        const plan = await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-1',
            itemType: 'epic',
        });
        expect(plan).toEqual([]);
        const epic = await testDb
            .selectFrom('items')
            .select(['assignee_agent_id', 'status'])
            .where('id', '=', 'epic-1')
            .executeTakeFirst();
        expect(epic?.assignee_agent_id).toBeNull();
        expect(epic?.status).toBe('in_progress'); // untouched
    });

    it('writes assignee AND status from the rule (performer → reviewer hop)', async () => {
        await seedEpic('epic-1');
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'agent-test-b',
                kind: 'on-pass',
                status: 'ready',
            })
            .execute();

        const plan = await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-1',
            itemType: 'epic',
        });
        expect(plan).toEqual([
            {
                itemId: 'epic-1',
                assigneeAgentId: 'agent-test-b',
                rawTargetAgentId: 'agent-test-b',
            },
        ]);
        const epic = await testDb
            .selectFrom('items')
            .select(['assignee_agent_id', 'status'])
            .where('id', '=', 'epic-1')
            .executeTakeFirst();
        expect(epic?.assignee_agent_id).toBe('agent-test-b');
        expect(epic?.status).toBe('ready');
    });

    it('writes status `in_review` and null assignee for a terminal reviewer rule (owner sentinel)', async () => {
        await seedEpic('epic-1');
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'owner',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();

        const plan = await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-1',
            itemType: 'epic',
        });
        expect(plan).toEqual([
            {
                itemId: 'epic-1',
                assigneeAgentId: null,
                rawTargetAgentId: 'owner',
            },
        ]);
        const epic = await testDb
            .selectFrom('items')
            .select(['assignee_agent_id', 'status'])
            .where('id', '=', 'epic-1')
            .executeTakeFirst();
        expect(epic?.assignee_agent_id).toBeNull();
        expect(epic?.status).toBe('in_review');
    });

    it('ignores on-fail rules when computing on-pass', async () => {
        await seedEpic('epic-1');
        await testDb
            .insertInto('agent_handoff_rules')
            .values([
                {
                    agent_id: 'agent-test-a',
                    target_agent_id: 'owner',
                    kind: 'on-fail',
                    status: 'waiting_for_info',
                },
            ])
            .execute();

        const plan = await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-1',
            itemType: 'epic',
        });
        expect(plan).toEqual([]);
        const epic = await testDb
            .selectFrom('items')
            .select(['assignee_agent_id', 'status'])
            .where('id', '=', 'epic-1')
            .executeTakeFirst();
        expect(epic?.assignee_agent_id).toBeNull();
        expect(epic?.status).toBe('in_progress');
    });
});

// ---------------------------------------------------------------------------
// Workstream #2 — applyOnPassHandoff writes BOTH a status_changed and an
// assigned event into `issue_events` so the data-driven handoff is visible
// in the activity feed. The 'owner' rule sentinel must NEVER appear in
// `issue_events.to_value`; assignee → Owner uses NULL, the same convention
// `issues.ts` already uses.
// ---------------------------------------------------------------------------

async function getIssueEvents(itemId: string): Promise<
    Array<{
        event_type: string;
        actor_agent_id: string | null;
        field: string | null;
        from_value: string | null;
        to_value: string | null;
    }>
> {
    const rows = await testDb
        .selectFrom('issue_events')
        .select(['event_type', 'actor_agent_id', 'field', 'from_value', 'to_value'])
        .where('item_id', '=', itemId)
        .orderBy('created_at', 'asc')
        .execute();
    return rows.map((r) => ({
        event_type: r.event_type as string,
        actor_agent_id: (r.actor_agent_id as string | null) ?? null,
        field: (r.field as string | null) ?? null,
        from_value: (r.from_value as string | null) ?? null,
        to_value: (r.to_value as string | null) ?? null,
    }));
}

describe('applyOnPassHandoff — event logging', () => {
    it('writes both a status_changed and an assigned event when the rule changes both fields', async () => {
        await seedEpic('epic-1');
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'agent-test-b',
                kind: 'on-pass',
                status: 'ready',
            })
            .execute();

        await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-1',
            itemType: 'epic',
        });

        const events = await getIssueEvents('epic-1');
        expect(events).toContainEqual({
            event_type: 'status_changed',
            actor_agent_id: 'agent-test-a',
            field: 'status',
            from_value: 'in_progress',
            to_value: 'ready',
        });
        expect(events).toContainEqual({
            event_type: 'assigned',
            actor_agent_id: 'agent-test-a',
            field: 'assignee',
            from_value: null,
            to_value: 'agent-test-b',
        });
    });

    it('writes assigned event with to_value=null when routing to Owner (no "owner" sentinel leaks into the audit row)', async () => {
        // Seed the item already assigned to agent-test-a so the assignee
        // actually changes when the rule routes to Owner.
        await testDb
            .insertInto('items')
            .values({
                id: 'epic-2',
                project_id: 'proj-test',
                type: 'epic',
                title: 'Parent epic',
                description: '',
                status: 'in_progress',
                assignee_agent_id: 'agent-test-a',
                parent_id: null,
                parent_type: null,
            })
            .execute();
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'owner',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();

        await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-2',
            itemType: 'epic',
        });

        const events = await getIssueEvents('epic-2');
        const assigned = events.find((e) => e.event_type === 'assigned');
        expect(assigned).toBeDefined();
        expect(assigned?.from_value).toBe('agent-test-a');
        expect(assigned?.to_value).toBeNull();
        // The 'owner' sentinel must NEVER appear in the event audit row.
        expect(events.every((e) => e.to_value !== 'owner')).toBe(true);
    });

    it('skips the status_changed event when the rule does not change status', async () => {
        // Seed the item already in `ready` so the rule's status (`ready`)
        // is a no-op for the status field; only the assignee changes.
        await testDb
            .insertInto('items')
            .values({
                id: 'epic-3',
                project_id: 'proj-test',
                type: 'epic',
                title: 'Parent epic',
                description: '',
                status: 'ready',
                assignee_agent_id: null,
                parent_id: null,
                parent_type: null,
            })
            .execute();
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'agent-test-b',
                kind: 'on-pass',
                status: 'ready',
            })
            .execute();

        await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-3',
            itemType: 'epic',
        });

        const events = await getIssueEvents('epic-3');
        expect(events.some((e) => e.event_type === 'status_changed')).toBe(false);
        expect(events.some((e) => e.event_type === 'assigned')).toBe(true);
    });

    it('writes no events when no rule matches (early return)', async () => {
        await seedEpic('epic-4');
        await applyOnPassHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-4',
            itemType: 'epic',
        });
        const events = await getIssueEvents('epic-4');
        expect(events).toEqual([]);
    });
});

describe('applyOnFailHandoff', () => {
    it('writes both status_changed and assigned events when the on-fail rule fires', async () => {
        // Item is currently assigned to agent-test-a, in_progress. The
        // on-fail rule routes to Owner with `waiting_for_info`.
        await testDb
            .insertInto('items')
            .values({
                id: 'epic-fail-1',
                project_id: 'proj-test',
                type: 'epic',
                title: 'Parent epic',
                description: '',
                status: 'in_progress',
                assignee_agent_id: 'agent-test-a',
                parent_id: null,
                parent_type: null,
            })
            .execute();
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'owner',
                kind: 'on-fail',
                status: 'waiting_for_info',
            })
            .execute();

        const plan = await applyOnFailHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-fail-1',
            itemType: 'epic',
        });

        expect(plan).toEqual([
            {
                itemId: 'epic-fail-1',
                assigneeAgentId: null,
                rawTargetAgentId: 'owner',
            },
        ]);

        // DB landed on the rule's status + null assignee.
        const epic = await testDb
            .selectFrom('items')
            .select(['assignee_agent_id', 'status'])
            .where('id', '=', 'epic-fail-1')
            .executeTakeFirst();
        expect(epic?.assignee_agent_id).toBeNull();
        expect(epic?.status).toBe('waiting_for_info');

        // Both events landed; neither carries the 'owner' literal.
        const events = await getIssueEvents('epic-fail-1');
        expect(events).toContainEqual({
            event_type: 'status_changed',
            actor_agent_id: 'agent-test-a',
            field: 'status',
            from_value: 'in_progress',
            to_value: 'waiting_for_info',
        });
        expect(events).toContainEqual({
            event_type: 'assigned',
            actor_agent_id: 'agent-test-a',
            field: 'assignee',
            from_value: 'agent-test-a',
            to_value: null,
        });
        expect(events.every((e) => e.to_value !== 'owner')).toBe(true);
    });

    it('returns empty plan and writes nothing when no on-fail rule matches', async () => {
        await seedEpic('epic-fail-2');
        const plan = await applyOnFailHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-fail-2',
            itemType: 'epic',
        });
        expect(plan).toEqual([]);
        const events = await getIssueEvents('epic-fail-2');
        expect(events).toEqual([]);
    });

    it('ignores on-pass rules when computing on-fail', async () => {
        await seedEpic('epic-fail-3');
        await testDb
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-test-a',
                target_agent_id: 'agent-test-b',
                kind: 'on-pass',
                status: 'ready',
            })
            .execute();

        const plan = await applyOnFailHandoff({
            agentId: 'agent-test-a',
            currentItemId: 'epic-fail-3',
            itemType: 'epic',
        });
        expect(plan).toEqual([]);
    });
});
