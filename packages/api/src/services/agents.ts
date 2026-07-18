import { db } from '../db/kysely-client.js';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type {
    IAgent,
    IAgentRun,
    IAgentHandoffRule,
    IAgentChecklistItem,
    IAgentPromptVersion,
    IssueStatus,
    IssueType,
    AgentHandoffKind,
    AgentSchedulePreset,
    AgentKindSlug,
    SdlcRole,
} from '@atlas/shared';
import { randomUUID } from 'crypto';
import { Cron } from 'croner';
import { computeNextAgentSlot, getSchedulingTimezone } from './agent-schedule-registry.js';

// Workstream #4 — Validation guard that rejects (cli, model) pairs not in
// `cli_models`. Throws a tagged Error the route layer recognises and
// converts to a 400; the composite FK from migration 061 catches anything
// that slips past, but this gives a clean message naming valid models.
export class ModelNotInRegistryError extends Error {
    public readonly code = 'MODEL_NOT_IN_REGISTRY';
    constructor(message: string) {
        super(message);
        this.name = 'ModelNotInRegistryError';
    }
}

// Rejects cron_expr strings that croner cannot parse. Thrown from create
// and update before any DB write so the API surface returns a 400 with a
// useful message instead of a silently-null next_run_at (which would
// otherwise leave the agent dormant).
export class CronExpressionInvalidError extends Error {
    public readonly code = 'CRON_EXPRESSION_INVALID';
    constructor(message: string) {
        super(message);
        this.name = 'CronExpressionInvalidError';
    }
}

export function assertCronExprValid(value: string | null | undefined): void {
    if (value == null) return;
    const trimmed = value.trim();
    if (trimmed === '') return;
    try {
        new Cron(trimmed, { paused: true });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new CronExpressionInvalidError(
            `cron_expr "${trimmed}" is not a valid croner expression: ${detail}`,
        );
    }
}

async function assertModelInRegistry(
    cli: string | undefined | null,
    model: string | undefined | null,
): Promise<void> {
    if (!cli || !model) return;
    // Kysely's typed `cli` column narrows to `'claude' | 'copilot'`. The
    // checked input is the application-level CLI value; cast through
    // `as 'claude'` (one of the literal members) so the type checks even
    // when an Owner passes a string the FK will then reject downstream.
    const cliCast = cli as 'claude' | 'copilot';
    const row = await db
        .selectFrom('cli_models')
        .select('id')
        .where('cli', '=', cliCast)
        .where('model_name', '=', model)
        .executeTakeFirst();
    if (row) return;
    const available = await db
        .selectFrom('cli_models')
        .select('model_name')
        .where('cli', '=', cliCast)
        .orderBy('sort_order', 'asc')
        .execute();
    const names = available.map((r) => String(r['model_name'])).join(', ') || '(empty)';
    throw new ModelNotInRegistryError(
        `model '${model}' is not in the cli_models registry for cli '${cli}' — pick from: ${names}`,
    );
}

export function asAgentRun(r: Record<string, unknown>, issueType: IssueType): IAgentRun {
    return {
        id: r['id'] as string,
        agent_id: r['agent_id'] as string,
        issue_type: issueType,
        issue_id: (r['item_id'] as string) ?? '',
        project_id: (r['project_id'] as string | null) ?? null,
        status: r['status'] as IAgentRun['status'],
        prompt_snapshot: (r['prompt_snapshot'] as string | null) ?? null,
        output_text: (r['output_text'] as string | null) ?? null,
        started_at: (r['started_at'] as string | null) ?? null,
        completed_at: (r['completed_at'] as string | null) ?? null,
        parent_run_id: (r['parent_run_id'] as string | null) ?? null,
        setup_output_text: (r['setup_output_text'] as string | null) ?? null,
        outcome_kind: (r['outcome_kind'] as IAgentRun['outcome_kind']) ?? null,
        outcome_summary: (r['outcome_summary'] as string | null) ?? null,
        outcome_reason: (r['outcome_reason'] as string | null) ?? null,
        outcome_checklist: (r['outcome_checklist'] as IAgentRun['outcome_checklist']) ?? null,
        created_at: r['created_at'] as string,
        input_tokens: (r['input_tokens'] as number | null) ?? null,
        output_tokens: (r['output_tokens'] as number | null) ?? null,
        cache_creation_tokens: (r['cache_creation_tokens'] as number | null) ?? null,
        cache_read_tokens: (r['cache_read_tokens'] as number | null) ?? null,
        total_cost_usd: (r['total_cost_usd'] as number | null) ?? null,
        credits: (r['credits'] as number | null) ?? null,
        // Joined from items.title — populated whenever the route query
        // pulls `i.title as item_title`. NULL on freedom-mode runs and
        // on rows whose item has been deleted.
        item_title: (r['item_title'] as string | null) ?? null,
    };
}

export interface IHandoffRuleInput {
    target_agent_id: string;
    kind: AgentHandoffKind;
    status: IssueStatus;
}

export interface IChecklistInput {
    label: string;
    sort_order?: number;
    required?: boolean;
}

// All optional fields explicitly carry `| undefined` so callers parsed via Zod
// (whose output types use `?: T | undefined`) satisfy `exactOptionalPropertyTypes`.
export interface IAgentCreateInput {
    id?: string | undefined;
    name: string;
    category: IAgent['category'];
    cli: IAgent['cli'];
    model: string;
    framework?: string | undefined;
    prompt_md?: string | undefined;
    handoff_prompt_md?: string | undefined;
    status?: IAgent['status'] | undefined;
    accent_color: string;
    sort_order?: number | undefined;
    description?: string | undefined;
    designation?: string | undefined;
    // A08 — FK into the SDLC role catalog. null = autonomous, no role.
    role_id?: SdlcRole | null | undefined;
    max_rounds?: number | undefined;
    requires_item?: boolean | undefined;
    schedule_hours?: number | undefined;
    schedule_preset?: AgentSchedulePreset | undefined;
    schedule_time_of_day?: string | null | undefined;
    schedule_weekdays?: number[] | null | undefined;
    schedule_day_of_month?: number | null | undefined;
    concurrent_runs?: number | undefined;
    glyph?: string | undefined;
    memory_cadence?: number | undefined;
    // Theme 09 — autonomous-agent metadata.
    kind_slug?: AgentKindSlug | undefined;
    settings_json?: Record<string, unknown> | undefined;
    cron_expr?: string | null | undefined;
    raises_pr?: boolean | undefined;
    push_code?: boolean | undefined;
    requires_worktree?: boolean | undefined;
    handoff_rules?: IHandoffRuleInput[] | undefined;
    checklists?: IChecklistInput[] | undefined;
}

export interface IAgentUpdateInput {
    name?: string | undefined;
    category?: IAgent['category'] | undefined;
    cli?: IAgent['cli'] | undefined;
    model?: string | undefined;
    framework?: string | undefined;
    prompt_md?: string | undefined;
    handoff_prompt_md?: string | undefined;
    status?: IAgent['status'] | undefined;
    accent_color?: string | undefined;
    sort_order?: number | undefined;
    description?: string | undefined;
    designation?: string | undefined;
    // A08 — re-pointing an agent at a different SDLC role.
    role_id?: SdlcRole | null | undefined;
    max_rounds?: number | undefined;
    requires_item?: boolean | undefined;
    schedule_hours?: number | undefined;
    schedule_preset?: AgentSchedulePreset | undefined;
    schedule_time_of_day?: string | null | undefined;
    schedule_weekdays?: number[] | null | undefined;
    schedule_day_of_month?: number | null | undefined;
    concurrent_runs?: number | undefined;
    glyph?: string | undefined;
    memory_cadence?: number | undefined;
    // Theme 09 — autonomous-agent metadata.
    kind_slug?: AgentKindSlug | undefined;
    settings_json?: Record<string, unknown> | undefined;
    cron_expr?: string | null | undefined;
    raises_pr?: boolean | undefined;
    push_code?: boolean | undefined;
    requires_worktree?: boolean | undefined;
    handoff_rules?: IHandoffRuleInput[] | undefined;
    checklists?: IChecklistInput[] | undefined;
}

const AGENT_SCALAR_FIELDS = [
    'name',
    'category',
    'cli',
    'model',
    'framework',
    'prompt_md',
    'handoff_prompt_md',
    'status',
    'accent_color',
    'sort_order',
    'description',
    'designation',
    'role_id',
    'max_rounds',
    'requires_item',
    'schedule_hours',
    'schedule_preset',
    'schedule_time_of_day',
    'schedule_weekdays',
    'schedule_day_of_month',
    'concurrent_runs',
    'glyph',
    'memory_cadence',
    'kind_slug',
    'settings_json',
    'cron_expr',
    'raises_pr',
    'push_code',
    'requires_worktree',
] as const;

const SCHEDULE_TRIGGER_FIELDS = [
    'schedule_preset',
    'schedule_hours',
    'schedule_time_of_day',
    'schedule_weekdays',
    'schedule_day_of_month',
    // cron_expr is an override-style schedule field: when non-empty, it
    // wins over the preset in computeNextAgentSlot. Without listing it
    // here, PATCH'ing only `cron_expr` would leave next_run_at frozen at
    // its previous value and the scheduler would dispatch on the old
    // cadence until something else triggered a reseed.
    'cron_expr',
    'status',
] as const;

function pickAgentScalars(input: IAgentCreateInput | IAgentUpdateInput): Record<string, unknown> {
    const src = input as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of AGENT_SCALAR_FIELDS) {
        if (key in src && src[key] !== undefined) {
            out[key] = src[key];
        }
    }
    return out;
}

async function replaceHandoffRules(
    trx: Transaction<DB>,
    agentId: string,
    rules: IHandoffRuleInput[]
): Promise<void> {
    await trx.deleteFrom('agent_handoff_rules').where('agent_id', '=', agentId).execute();
    if (rules.length === 0) return;
    await trx
        .insertInto('agent_handoff_rules')
        .values(
            rules.map((r) => ({
                agent_id: agentId,
                target_agent_id: r.target_agent_id,
                kind: r.kind,
                status: r.status,
            }))
        )
        .execute();
}

async function replaceChecklists(
    trx: Transaction<DB>,
    agentId: string,
    items: IChecklistInput[]
): Promise<void> {
    await trx.deleteFrom('agent_checklists').where('agent_id', '=', agentId).execute();
    if (items.length === 0) return;
    await trx
        .insertInto('agent_checklists')
        .values(
            items.map((c, idx) => ({
                agent_id: agentId,
                label: c.label,
                sort_order: c.sort_order ?? idx,
                required: c.required ?? true,
            }))
        )
        .execute();
}

export const agentsService = {
    async list(): Promise<IAgent[]> {
        const rows = await db.selectFrom('agents').selectAll().orderBy('name', 'asc').execute();
        return rows as unknown as IAgent[];
    },

    async get(id: string): Promise<IAgent | undefined> {
        const row = await db.selectFrom('agents').selectAll().where('id', '=', id).executeTakeFirst();
        return row as unknown as IAgent | undefined;
    },

    async create(data: IAgentCreateInput): Promise<IAgent> {
        // Workstream #4 — block create when (cli, model) isn't in the
        // registry. Belt-and-suspenders alongside the composite FK
        // (migration 061): the FK gives correctness, this gives a clean
        // 400 with a useful "pick from: …" message instead of a raw
        // PG constraint error.
        await assertModelInRegistry(data.cli, data.model);
        assertCronExprValid(data.cron_expr);
        const id = data.id ?? randomUUID();
        const scalars = pickAgentScalars(data);
        const status = (scalars['status'] as IAgent['status']) ?? 'active';
        const scheduleHours = (scalars['schedule_hours'] as number | undefined) ?? 6;
        const schedulePreset =
            (scalars['schedule_preset'] as AgentSchedulePreset | undefined) ??
            'every_n_hours';
        const scheduleTimeOfDay =
            (scalars['schedule_time_of_day'] as string | null | undefined) ?? null;
        const scheduleWeekdays =
            (scalars['schedule_weekdays'] as number[] | null | undefined) ?? null;
        const scheduleDayOfMonth =
            (scalars['schedule_day_of_month'] as number | null | undefined) ?? null;
        // Seed next_run_at at create time using the preset-aware math. The
        // scheduler only checks `next_run_at <= now`; it never re-anchors
        // at boot. Inactive agents are left with next_run_at=null since
        // the poller filters those out.
        const createTz = status === 'active' ? await getSchedulingTimezone() : undefined;
        const nextRunAt =
            status === 'active'
                ? computeNextAgentSlot(
                      new Date(),
                      {
                          schedule_preset: schedulePreset,
                          schedule_hours: scheduleHours,
                          schedule_time_of_day: scheduleTimeOfDay,
                          schedule_weekdays: scheduleWeekdays,
                          schedule_day_of_month: scheduleDayOfMonth,
                      },
                      createTz,
                  ).toISOString()
                : null;
        return await db.transaction().execute(async (trx) => {
            const inserted = await trx
                .insertInto('agents')
                .values({
                    id,
                    name: data.name,
                    category: data.category,
                    cli: data.cli,
                    model: data.model,
                    framework: (scalars['framework'] as string | undefined) ?? '',
                    prompt_md: (scalars['prompt_md'] as string | undefined) ?? '',
                    handoff_prompt_md:
                        (scalars['handoff_prompt_md'] as string | undefined) ?? '',
                    status,
                    accent_color: data.accent_color,
                    sort_order: (scalars['sort_order'] as number | undefined) ?? 0,
                    description: (scalars['description'] as string | undefined) ?? '',
                    schedule_hours: scheduleHours,
                    schedule_preset: schedulePreset,
                    schedule_time_of_day: scheduleTimeOfDay,
                    schedule_weekdays: scheduleWeekdays,
                    schedule_day_of_month: scheduleDayOfMonth,
                    concurrent_runs: (scalars['concurrent_runs'] as number | undefined) ?? 1,
                    glyph: (scalars['glyph'] as string | undefined) ?? '',
                    memory_cadence: (scalars['memory_cadence'] as number | undefined) ?? 1,
                    kind_slug: (scalars['kind_slug'] as AgentKindSlug | undefined) ?? 'custom',
                    settings_json: (scalars['settings_json'] as Record<string, unknown> | undefined) ?? {},
                    cron_expr: (scalars['cron_expr'] as string | null | undefined) ?? null,
                    // A08 — optional FK to the SDLC role catalog. null
                    // keeps the agent in autonomous/unbound state.
                    role_id: (scalars['role_id'] as string | null | undefined) ?? null,
                    next_run_at: nextRunAt,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await trx
                .insertInto('agent_prompt_versions')
                .values({
                    agent_id: id,
                    version: (inserted as unknown as IAgent).prompt_version,
                    body_md: (inserted as unknown as IAgent).prompt_md,
                    edited_by: 'Owner',
                })
                .execute();

            await trx
                .insertInto('agent_memory')
                .values({ agent_id: id, body_md: '', version: 1, source: 'ai-generated' })
                .onConflict((oc) => oc.column('agent_id').doNothing())
                .execute();

            if (data.handoff_rules) await replaceHandoffRules(trx, id, data.handoff_rules);
            if (data.checklists) await replaceChecklists(trx, id, data.checklists);

            return inserted as unknown as IAgent;
        });
    },

    async update(id: string, data: IAgentUpdateInput): Promise<IAgent> {
        // Workstream #4 — re-check the (cli, model) pair when either
        // changes. We need both sides to validate; if only one is in the
        // patch body, fetch the other from the existing row.
        if (data.cli !== undefined || data.model !== undefined) {
            const existing = await this.get(id);
            const cli = data.cli ?? existing?.cli ?? null;
            const model = data.model ?? existing?.model ?? null;
            await assertModelInRegistry(cli, model);
        }
        if (data.cron_expr !== undefined) assertCronExprValid(data.cron_expr);
        const scalars = pickAgentScalars(data);
        const promptMdChanged = 'prompt_md' in data && data.prompt_md !== undefined;
        return await db.transaction().execute(async (trx) => {
            let row: IAgent;
            if (promptMdChanged) {
                // Editing `prompt_md` bumps `prompt_version` and snapshots
                // the new body into `agent_prompt_versions` for revert-safety.
                row = (await trx
                    .updateTable('agents')
                    .set(
                        ((eb: unknown) => {
                            const set: Record<string, unknown> = {
                                ...(scalars as Record<string, unknown>),
                            };
                            const incEb = eb as {
                                (col: 'prompt_version', op: '+', val: number): unknown;
                            };
                            set['prompt_version'] = incEb('prompt_version', '+', 1);
                            return set;
                        }) as never,
                    )
                    .where('id', '=', id)
                    .returningAll()
                    .executeTakeFirstOrThrow()) as unknown as IAgent;
                await trx
                    .insertInto('agent_prompt_versions')
                    .values({
                        agent_id: id,
                        version: row.prompt_version,
                        body_md: row.prompt_md,
                        edited_by: 'Owner',
                    })
                    .execute();
            } else if (Object.keys(scalars).length > 0) {
                row = (await trx
                    .updateTable('agents')
                    .set(scalars as never)
                    .where('id', '=', id)
                    .returningAll()
                    .executeTakeFirstOrThrow()) as unknown as IAgent;
            } else {
                row = (await trx
                    .selectFrom('agents')
                    .selectAll()
                    .where('id', '=', id)
                    .executeTakeFirstOrThrow()) as unknown as IAgent;
            }

            if (data.handoff_rules !== undefined) {
                await replaceHandoffRules(trx, id, data.handoff_rules);
            }
            if (data.checklists !== undefined) {
                await replaceChecklists(trx, id, data.checklists);
            }

            // When status or any schedule field changes, recompute
            // next_run_at via the preset-aware math. The dispatcher walks
            // it forward by calling computeNextAgentSlot too, so this
            // create/modify path stays in lockstep with how dispatch
            // advances the clock. concurrent_runs is a fan-out cap, not a
            // cadence input, so it doesn't need a reseed.
            const scheduleTouched = SCHEDULE_TRIGGER_FIELDS.some(
                (f) => f in scalars,
            );
            if (scheduleTouched) {
                let nextRunAt: string | null = null;
                if (row.status === 'active') {
                    try {
                        const updateTz = await getSchedulingTimezone();
                        nextRunAt = computeNextAgentSlot(new Date(), row, updateTz).toISOString();
                    } catch {
                        // Invalid schedule combo (e.g. monthly without
                        // day_of_month). Leave next_run_at null; the
                        // scheduler will skip the row and the operator can
                        // fix the config from the UI.
                        nextRunAt = null;
                    }
                }
                await trx
                    .updateTable('agents')
                    .set({ next_run_at: nextRunAt })
                    .where('id', '=', id)
                    .execute();
                row = { ...row, next_run_at: nextRunAt };
            }

            return row;
        });
    },

    async listPromptVersions(agentId: string): Promise<IAgentPromptVersion[]> {
        const rows = await db
            .selectFrom('agent_prompt_versions')
            .selectAll()
            .where('agent_id', '=', agentId)
            .orderBy('version', 'desc')
            .execute();
        return rows as unknown as IAgentPromptVersion[];
    },

    async revertPrompt(agentId: string, sourceVersion: number): Promise<IAgent> {
        const agent = await this.get(agentId);
        if (!agent) throw new Error('Agent not found');
        const source = await db
            .selectFrom('agent_prompt_versions')
            .select('body_md')
            .where('agent_id', '=', agentId)
            .where('version', '=', sourceVersion)
            .executeTakeFirst();
        if (!source) throw new Error('Version not found');
        if (source.body_md === agent.prompt_md) return agent;
        const nextVersion = agent.prompt_version + 1;
        await db.transaction().execute(async (trx) => {
            await trx
                .updateTable('agents')
                .set({ prompt_md: source.body_md, prompt_version: nextVersion })
                .where('id', '=', agentId)
                .execute();
            await trx
                .insertInto('agent_prompt_versions')
                .values({
                    agent_id: agentId,
                    version: nextVersion,
                    body_md: source.body_md,
                    edited_by: 'Owner',
                    reverted_from: sourceVersion,
                })
                .execute();
        });
        return (await this.get(agentId))!;
    },

    async delete(id: string): Promise<void> {
        await db.deleteFrom('agents').where('id', '=', id).execute();
    },

    async getRuns(agentId: string): Promise<IAgentRun[]> {
        // List projection: drop prompt_snapshot entirely and truncate
        // output_text to head + tail. See `routes/run.ts` for full
        // rationale — same pattern, same trade-off. The Agent / Overview
        // tile and the Runs tab only render summary + last-line preview,
        // both of which survive the truncation.
        const rows = await db
            .selectFrom('agent_runs as r')
            .leftJoin('items as i', 'i.id', 'r.item_id')
            .select([
                'r.id as id',
                'r.agent_id as agent_id',
                'r.item_id as item_id',
                'i.type as item_type',
                'i.title as item_title',
                'r.status as status',
                sql<string | null>`NULL::text`.as('prompt_snapshot'),
                sql<string | null>`CASE
                    WHEN r.output_text IS NULL THEN NULL
                    WHEN length(r.output_text) <= 400 THEN r.output_text
                    ELSE left(r.output_text, 100) || E'\n…[elided]…\n' || right(r.output_text, 300)
                END`.as('output_text'),
                'r.started_at as started_at',
                'r.completed_at as completed_at',
                'r.created_at as created_at',
                'r.input_tokens as input_tokens',
                'r.output_tokens as output_tokens',
                'r.cache_creation_tokens as cache_creation_tokens',
                'r.cache_read_tokens as cache_read_tokens',
                'r.total_cost_usd as total_cost_usd',
            ])
            .where('r.agent_id', '=', agentId)
            .orderBy('r.created_at', 'desc')
            .execute();
        return rows.map((r) => asAgentRun(r as never, (r.item_type as IssueType) ?? 'story'));
    },

    async getHandoffRules(agentId: string): Promise<IAgentHandoffRule[]> {
        const rows = await db
            .selectFrom('agent_handoff_rules')
            .selectAll()
            .where('agent_id', '=', agentId)
            .orderBy('kind', 'asc')
            .execute();
        return rows as unknown as IAgentHandoffRule[];
    },

    async setHandoffRules(agentId: string, rules: IHandoffRuleInput[]): Promise<void> {
        await db.transaction().execute(async (trx) => {
            await replaceHandoffRules(trx, agentId, rules);
        });
    },

    async getChecklists(agentId: string): Promise<IAgentChecklistItem[]> {
        const rows = await db
            .selectFrom('agent_checklists')
            .selectAll()
            .where('agent_id', '=', agentId)
            .orderBy('sort_order', 'asc')
            .execute();
        return rows as unknown as IAgentChecklistItem[];
    },

    async setChecklists(agentId: string, items: IChecklistInput[]): Promise<void> {
        await db.transaction().execute(async (trx) => {
            await replaceChecklists(trx, agentId, items);
        });
    },
};
