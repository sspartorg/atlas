// Marketplace service. Reads the marketplace_agents table (seeded by
// runSeed from the catalog folder), provides search / get-full / diff /
// install. The catalog folder is touched ONLY by the seed script — at
// request time the DB is authoritative.
//
// Generic-runner discipline ([[feedback_orchestrator_no_agent_specific]]):
// nothing here matches on specific agent ids or kind_slugs. The
// marketplace is a generic catalog; agent-specific behavior lives in
// each agent's prompt.

import { db } from '../db/kysely-client.js';
import { agentsService } from './agents.js';
import { packAgentBundle, type AgentBundle } from './agent-bundle.js';
import type {
    AgentCategory,
    AgentKindSlug,
    AgentStatus,
    AgentSchedulePreset,
    AgentCli,
    IAgent,
    IAgentBundleManifest,
    IMarketplaceAgent,
    IMarketplaceAgentChecklist,
    IMarketplaceAgentFull,
    IMarketplaceAgentHandoff,
    IMarketplaceAgentSummary,
    IMarketplaceUpgradeDiff,
    MarketplaceUpgradeField,
    SdlcRole,
} from '@atlas/shared';

/**
 * Local agent slug is already taken. The collision is resolved at the UI
 * layer by asking the Owner for a different slug — the catalog copy is
 * then installed under that new slug, leaving the existing local agent
 * (which may be a detached / customized copy) untouched.
 */
export class MarketplaceSlugTakenError extends Error {
    constructor(
        public readonly conflictingId: string,
        public readonly suggestedId: string,
    ) {
        super(`local agent slug '${conflictingId}' is already in use; pick a different slug`);
        this.name = 'MarketplaceSlugTakenError';
    }
}

/** Tiny helper for the modal's "rename" pre-fill. Deterministic per
 *  process boot would be uglier (no entropy), and the slug doesn't need to
 *  collide-avoid the entire `agents` table — the modal just shows it as a
 *  starting point the Owner can edit before submitting. */
function suggestAlternateSlug(catalogId: string): string {
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${catalogId}-${suffix}`;
}

export class MarketplaceNotFoundError extends Error {
    constructor(public readonly agentId: string) {
        super(`marketplace agent '${agentId}' not found`);
        this.name = 'MarketplaceNotFoundError';
    }
}

function toMarketplaceAgent(r: Record<string, unknown>): IMarketplaceAgent {
    return {
        id: r['id'] as string,
        name: r['name'] as string,
        category: r['category'] as AgentCategory,
        cli: r['cli'] as AgentCli,
        model: r['model'] as string,
        /* v8 ignore next -- effort is NOT NULL DEFAULT 'medium' at the DB level; `??` branch is unreachable defensive code */
        effort: (r['effort'] as IMarketplaceAgent['effort']) ?? 'medium',
        framework: r['framework'] as string,
        prompt_md: r['prompt_md'] as string,
        handoff_prompt_md: r['handoff_prompt_md'] as string,
        description: r['description'] as string,
        designation: r['designation'] as string,
        accent_color: r['accent_color'] as string,
        sort_order: r['sort_order'] as number,
        glyph: r['glyph'] as string,
        role_id: (r['role_id'] as SdlcRole | null) ?? null,
        max_rounds: r['max_rounds'] as number,
        requires_item: r['requires_item'] as boolean,
        requires_worktree: r['requires_worktree'] as boolean,
        push_code: r['push_code'] as boolean,
        raises_pr: r['raises_pr'] as boolean,
        status: r['status'] as AgentStatus,
        kind_slug: r['kind_slug'] as AgentKindSlug,
        /* v8 ignore next -- settings_json is NOT NULL DEFAULT '{}' at the DB level; `??` branch is unreachable defensive code */
        settings_json: (r['settings_json'] as Record<string, unknown>) ?? {},
        schedule_hours: r['schedule_hours'] as number,
        schedule_preset: r['schedule_preset'] as AgentSchedulePreset,
        schedule_time_of_day: (r['schedule_time_of_day'] as string | null) ?? null,
        schedule_weekdays: (r['schedule_weekdays'] as number[] | null) ?? null,
        schedule_day_of_month: (r['schedule_day_of_month'] as number | null) ?? null,
        cron_expr: (r['cron_expr'] as string | null) ?? null,
        concurrent_runs: r['concurrent_runs'] as number,
        memory_cadence: r['memory_cadence'] as number,
        /* v8 ignore next -- memory_template_md is NOT NULL DEFAULT '' at the DB level; `??` branch is unreachable defensive code */
        memory_template_md: (r['memory_template_md'] as string) ?? '',
        /* v8 ignore next -- summary is NOT NULL DEFAULT '' at the DB level; `??` branch is unreachable defensive code */
        summary: (r['summary'] as string) ?? '',
        version: r['version'] as number,
        published_at: String(r['published_at']),
        updated_at: String(r['updated_at']),
    };
}

function toManifest(agent: IMarketplaceAgent): IAgentBundleManifest {
    return {
        id: agent.id,
        name: agent.name,
        category: agent.category,
        cli: agent.cli,
        model: agent.model,
        effort: agent.effort,
        framework: agent.framework,
        description: agent.description,
        designation: agent.designation,
        accent_color: agent.accent_color,
        sort_order: agent.sort_order,
        glyph: agent.glyph,
        role_id: agent.role_id,
        max_rounds: agent.max_rounds,
        requires_item: agent.requires_item,
        requires_worktree: agent.requires_worktree,
        push_code: agent.push_code,
        raises_pr: agent.raises_pr,
        status: agent.status,
        kind_slug: agent.kind_slug,
        settings_json: agent.settings_json,
        schedule_hours: agent.schedule_hours,
        schedule_preset: agent.schedule_preset,
        schedule_time_of_day: agent.schedule_time_of_day,
        schedule_weekdays: agent.schedule_weekdays,
        schedule_day_of_month: agent.schedule_day_of_month,
        cron_expr: agent.cron_expr,
        concurrent_runs: agent.concurrent_runs,
        memory_cadence: agent.memory_cadence,
        handoff_prompt_md: agent.handoff_prompt_md,
        summary: agent.summary,
        version: agent.version,
        published_at: agent.published_at,
    };
}

function manifestFromLocalAgent(agent: IAgent, summary: string): IAgentBundleManifest {
    return {
        id: agent.id,
        name: agent.name,
        category: agent.category,
        cli: agent.cli,
        model: agent.model,
        effort: agent.effort,
        framework: agent.framework,
        description: agent.description,
        designation: agent.designation,
        accent_color: agent.accent_color,
        sort_order: agent.sort_order,
        glyph: agent.glyph,
        role_id: agent.role_id,
        max_rounds: agent.max_rounds,
        requires_item: agent.requires_item,
        requires_worktree: agent.requires_worktree,
        push_code: agent.push_code,
        raises_pr: agent.raises_pr,
        status: agent.status,
        kind_slug: agent.kind_slug,
        settings_json: agent.settings_json,
        schedule_hours: agent.schedule_hours,
        schedule_preset: agent.schedule_preset,
        schedule_time_of_day: agent.schedule_time_of_day,
        schedule_weekdays: agent.schedule_weekdays,
        schedule_day_of_month: agent.schedule_day_of_month,
        cron_expr: agent.cron_expr,
        concurrent_runs: agent.concurrent_runs,
        memory_cadence: agent.memory_cadence,
        handoff_prompt_md: agent.handoff_prompt_md,
        summary,
        // Exported bundle carries a self-version of 1 unless the local
        // agent has a pinned marketplace_pulled_version (rare for export).
        version: agent.marketplace_pulled_version ?? 1,
        published_at: agent.created_at,
    };
}

export interface MarketplaceSearchInput {
    query?: string | undefined;
    category?: AgentCategory | undefined;
    kind_slug?: AgentKindSlug | undefined;
    limit?: number | undefined;
}

export const marketplaceService = {
    async search(input: MarketplaceSearchInput = {}): Promise<IMarketplaceAgentSummary[]> {
        let q = db.selectFrom('marketplace_agents').selectAll();
        if (input.category) q = q.where('category', '=', input.category);
        if (input.kind_slug) q = q.where('kind_slug', '=', input.kind_slug);
        if (input.query && input.query.trim() !== '') {
            const needle = `%${input.query.trim().toLowerCase()}%`;
            q = q.where((eb) =>
                eb.or([
                    eb(eb.fn('lower', ['name']), 'like', needle),
                    eb(eb.fn('lower', ['description']), 'like', needle),
                    eb(eb.fn('lower', ['summary']), 'like', needle),
                    eb(eb.fn('lower', ['designation']), 'like', needle),
                ]),
            );
        }
        const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
        const rows = await q.orderBy('sort_order', 'asc').limit(limit).execute();
        if (rows.length === 0) return [];

        const ids = rows.map((r) => r['id'] as string);
        // A catalog entry is "installed" if and only if some local agent
        // has marketplace_source_id pointing at it. The local agent's own
        // id is irrelevant — once detached (source_id=NULL), the agent is
        // gone from the catalog's POV and the marketplace shows Add again.
        const localRows = await db
            .selectFrom('agents')
            .select(['id', 'marketplace_source_id', 'marketplace_pulled_version'])
            .where('marketplace_source_id', 'in', ids)
            .execute();
        const installedByCatalogId = new Map<
            string,
            { installed_agent_id: string; installed_version: number | null }
        >();
        for (const r of localRows) {
            const linkId = r['marketplace_source_id'] as string;
            // First write wins. If the Owner has installed the same catalog
            // entry under multiple slugs (e.g. original + a fork), we pick
            // the first one — the marketplace listing carries one summary
            // per catalog row, so we have to choose.
            if (!installedByCatalogId.has(linkId)) {
                installedByCatalogId.set(linkId, {
                    installed_agent_id: r['id'] as string,
                    installed_version: (r['marketplace_pulled_version'] as number | null) ?? null,
                });
            }
        }

        return rows.map((r) => {
            const id = r['id'] as string;
            const catalogVersion = r['version'] as number;
            const local = installedByCatalogId.get(id);
            const installed_version = local?.installed_version ?? null;
            const isInstalled = local != null;
            return {
                id,
                name: r['name'] as string,
                category: r['category'] as AgentCategory,
                kind_slug: r['kind_slug'] as AgentKindSlug,
                /* v8 ignore next -- summary is NOT NULL DEFAULT '' at the DB level; `??` branch is unreachable defensive code */
                summary: (r['summary'] as string) ?? '',
                accent_color: r['accent_color'] as string,
                glyph: r['glyph'] as string,
                version: catalogVersion,
                is_installed: isInstalled,
                // is_linked is now equivalent to is_installed; kept on the
                // shape for one release for back-compat with older clients.
                is_linked: isInstalled,
                installed_agent_id: local?.installed_agent_id ?? null,
                installed_version,
                upgrade_available:
                    isInstalled &&
                    installed_version != null &&
                    installed_version < catalogVersion,
            };
        });
    },

    async getFull(id: string): Promise<IMarketplaceAgentFull | undefined> {
        const row = await db
            .selectFrom('marketplace_agents')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (!row) return undefined;
        const agent = toMarketplaceAgent(row);
        const [handoffs, checklists] = await Promise.all([
            db
                .selectFrom('marketplace_agent_handoffs')
                .select(['target_agent_id', 'kind', 'status'])
                .where('marketplace_agent_id', '=', id)
                .orderBy('kind', 'asc')
                .execute(),
            db
                .selectFrom('marketplace_agent_checklists')
                .select(['label', 'sort_order', 'required'])
                .where('marketplace_agent_id', '=', id)
                .orderBy('sort_order', 'asc')
                .execute(),
        ]);
        return {
            agent,
            handoff_rules: handoffs as unknown as IMarketplaceAgentHandoff[],
            checklists: checklists as unknown as IMarketplaceAgentChecklist[],
        };
    },

    async exportCatalogBundle(id: string): Promise<Buffer> {
        const full = await this.getFull(id);
        if (!full) throw new MarketplaceNotFoundError(id);
        return await packAgentBundle({
            manifest: toManifest(full.agent),
            prompt_md: full.agent.prompt_md,
            memory_md: full.agent.memory_template_md,
            handoff_rules: full.handoff_rules,
            checklists: full.checklists,
        });
    },

    async exportLocalBundle(agentId: string): Promise<Buffer> {
        const agent = await agentsService.get(agentId);
        if (!agent) throw new MarketplaceNotFoundError(agentId);
        const [handoffs, checklists, memory] = await Promise.all([
            agentsService.getHandoffRules(agentId),
            agentsService.getChecklists(agentId),
            db
                .selectFrom('agent_memory')
                .select('body_md')
                .where('agent_id', '=', agentId)
                .executeTakeFirst(),
        ]);
        // Local agents don't carry the per-row summary the catalog has; we
        // derive one from the description so the round-trip is meaningful.
        const summary =
            agent.description.length > 220
                ? agent.description.slice(0, 217) + '...'
                : agent.description;
        return await packAgentBundle({
            manifest: manifestFromLocalAgent(agent, summary),
            prompt_md: agent.prompt_md,
            memory_md: memory?.body_md ?? '',
            handoff_rules: handoffs.map((h) => ({
                target_agent_id: h.target_agent_id,
                kind: h.kind,
                status: h.status,
            })),
            checklists: checklists.map((c) => ({
                label: c.label,
                sort_order: c.sort_order,
                required: c.required,
            })),
        });
    },

    async install(
        catalogId: string,
        options: { agent_id?: string | undefined } = {},
    ): Promise<IAgent> {
        const full = await this.getFull(catalogId);
        if (!full) throw new MarketplaceNotFoundError(catalogId);
        const { agent: m, handoff_rules, checklists } = full;

        // Target slug for the local row. Defaults to the catalog id; the
        // Owner can override (via the AddFromMarketplaceModal "rename"
        // step) when the default is already taken locally.
        const targetId = (options.agent_id && options.agent_id.trim()) || catalogId;
        const existing = await agentsService.get(targetId);
        if (existing) {
            throw new MarketplaceSlugTakenError(targetId, suggestAlternateSlug(catalogId));
        }

        return await db.transaction().execute(async (trx) => {
            await trx
                .insertInto('agents')
                .values({
                    id: targetId,
                    name: m.name,
                    category: m.category,
                    cli: m.cli,
                    model: m.model,
                    effort: m.effort,
                    framework: m.framework,
                    prompt_md: m.prompt_md,
                    prompt_version: 1,
                    handoff_prompt_md: m.handoff_prompt_md,
                    status: m.status,
                    accent_color: m.accent_color,
                    sort_order: m.sort_order,
                    description: m.description,
                    designation: m.designation,
                    role_id: m.role_id,
                    max_rounds: m.max_rounds,
                    requires_item: m.requires_item,
                    schedule_hours: m.schedule_hours,
                    schedule_preset: m.schedule_preset,
                    schedule_time_of_day: m.schedule_time_of_day,
                    schedule_weekdays: m.schedule_weekdays,
                    schedule_day_of_month: m.schedule_day_of_month,
                    concurrent_runs: m.concurrent_runs,
                    glyph: m.glyph,
                    memory_cadence: m.memory_cadence,
                    kind_slug: m.kind_slug,
                    settings_json: m.settings_json,
                    cron_expr: m.cron_expr,
                    raises_pr: m.raises_pr,
                    push_code: m.push_code,
                    requires_worktree: m.requires_worktree,
                    // marketplace_source_id points at the CATALOG id (m.id),
                    // not the local slug — that's how upgrades keep flowing
                    // even after the user installs under a custom slug.
                    marketplace_source_id: m.id,
                    marketplace_pulled_version: m.version,
                })
                .execute();
            await trx
                .insertInto('agent_prompt_versions')
                .values({
                    agent_id: targetId,
                    version: 1,
                    body_md: m.prompt_md,
                    edited_by: 'Owner',
                })
                .execute();
            await trx
                .insertInto('agent_memory')
                .values({
                    agent_id: targetId,
                    body_md: full.agent.memory_template_md,
                    version: 1,
                    source: 'ai-generated' as const,
                })
                .execute();
            if (handoff_rules.length > 0) {
                await trx
                    .insertInto('agent_handoff_rules')
                    .values(
                        handoff_rules.map((h) => ({
                            agent_id: targetId,
                            target_agent_id: h.target_agent_id,
                            kind: h.kind,
                            status: h.status,
                        })),
                    )
                    .execute();
            }
            if (checklists.length > 0) {
                await trx
                    .insertInto('agent_checklists')
                    .values(
                        checklists.map((c) => ({
                            agent_id: targetId,
                            label: c.label,
                            sort_order: c.sort_order,
                            required: c.required,
                        })),
                    )
                    .execute();
            }
            const row = await trx
                .selectFrom('agents')
                .selectAll()
                .where('id', '=', targetId)
                .executeTakeFirstOrThrow();
            return row as unknown as IAgent;
        });
    },

    async diff(catalogId: string, localAgentId: string): Promise<IMarketplaceUpgradeDiff> {
        const [full, agent, localHandoffs, localChecklists] = await Promise.all([
            this.getFull(catalogId),
            agentsService.get(localAgentId),
            agentsService.getHandoffRules(localAgentId),
            agentsService.getChecklists(localAgentId),
        ]);
        if (!full) throw new MarketplaceNotFoundError(catalogId);
        if (!agent) throw new MarketplaceNotFoundError(localAgentId);

        const fromHandoffs: IMarketplaceAgentHandoff[] = localHandoffs.map((h) => ({
            target_agent_id: h.target_agent_id,
            kind: h.kind,
            status: h.status,
        }));
        const fromChecklists: IMarketplaceAgentChecklist[] = localChecklists.map((c) => ({
            label: c.label,
            sort_order: c.sort_order,
            required: c.required,
        }));

        const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

        return {
            marketplace_id: catalogId,
            local_agent_id: localAgentId,
            marketplace_version: full.agent.version,
            local_pulled_version: agent.marketplace_pulled_version ?? null,
            fields: {
                prompt_md: {
                    from: agent.prompt_md,
                    to: full.agent.prompt_md,
                    changed: agent.prompt_md !== full.agent.prompt_md,
                },
                handoff_prompt_md: {
                    from: agent.handoff_prompt_md,
                    to: full.agent.handoff_prompt_md,
                    changed: agent.handoff_prompt_md !== full.agent.handoff_prompt_md,
                },
                settings_json: {
                    from: agent.settings_json,
                    to: full.agent.settings_json,
                    changed: !jsonEqual(agent.settings_json, full.agent.settings_json),
                },
                handoff_rules: {
                    from: fromHandoffs,
                    to: full.handoff_rules,
                    changed: !jsonEqual(fromHandoffs, full.handoff_rules),
                },
                checklists: {
                    from: fromChecklists,
                    to: full.checklists,
                    changed: !jsonEqual(fromChecklists, full.checklists),
                },
            },
        };
    },

    async acceptUpgrade(
        localAgentId: string,
        fields: MarketplaceUpgradeField[],
    ): Promise<IAgent> {
        const agent = await agentsService.get(localAgentId);
        if (!agent) throw new MarketplaceNotFoundError(localAgentId);
        if (!agent.marketplace_source_id) {
            throw new Error(`agent '${localAgentId}' is not back-linked to a marketplace source`);
        }
        const full = await this.getFull(agent.marketplace_source_id);
        if (!full) throw new MarketplaceNotFoundError(agent.marketplace_source_id);

        await db.transaction().execute(async (trx) => {
            if (fields.includes('prompt_md') && full.agent.prompt_md !== agent.prompt_md) {
                const nextPromptVersion = agent.prompt_version + 1;
                await trx
                    .updateTable('agents')
                    .set({
                        prompt_md: full.agent.prompt_md,
                        prompt_version: nextPromptVersion,
                    })
                    .where('id', '=', localAgentId)
                    .execute();
                await trx
                    .insertInto('agent_prompt_versions')
                    .values({
                        agent_id: localAgentId,
                        version: nextPromptVersion,
                        body_md: full.agent.prompt_md,
                        edited_by: 'Marketplace',
                    })
                    .execute();
            }
            if (fields.includes('handoff_prompt_md')) {
                await trx
                    .updateTable('agents')
                    .set({ handoff_prompt_md: full.agent.handoff_prompt_md })
                    .where('id', '=', localAgentId)
                    .execute();
            }
            if (fields.includes('settings_json')) {
                await trx
                    .updateTable('agents')
                    .set({ settings_json: full.agent.settings_json })
                    .where('id', '=', localAgentId)
                    .execute();
            }
            if (fields.includes('handoff_rules')) {
                await trx
                    .deleteFrom('agent_handoff_rules')
                    .where('agent_id', '=', localAgentId)
                    .execute();
                if (full.handoff_rules.length > 0) {
                    await trx
                        .insertInto('agent_handoff_rules')
                        .values(
                            full.handoff_rules.map((h) => ({
                                agent_id: localAgentId,
                                target_agent_id: h.target_agent_id,
                                kind: h.kind,
                                status: h.status,
                            })),
                        )
                        .execute();
                }
            }
            if (fields.includes('checklists')) {
                await trx
                    .deleteFrom('agent_checklists')
                    .where('agent_id', '=', localAgentId)
                    .execute();
                if (full.checklists.length > 0) {
                    await trx
                        .insertInto('agent_checklists')
                        .values(
                            full.checklists.map((c) => ({
                                agent_id: localAgentId,
                                label: c.label,
                                sort_order: c.sort_order,
                                required: c.required,
                            })),
                        )
                        .execute();
                }
            }
            // Always bump pulled_version after a successful accept — even if
            // the user un-checked every field, that's a "Dismiss" decision
            // which is handled by dismissUpgrade. Reaching acceptUpgrade
            // means at least one field was applied, so it's safe to advance.
            await trx
                .updateTable('agents')
                .set({ marketplace_pulled_version: full.agent.version })
                .where('id', '=', localAgentId)
                .execute();
        });
        const refreshed = await agentsService.get(localAgentId);
        return refreshed!;
    },

    async dismissUpgrade(localAgentId: string): Promise<IAgent> {
        const agent = await agentsService.get(localAgentId);
        if (!agent) throw new MarketplaceNotFoundError(localAgentId);
        if (!agent.marketplace_source_id) {
            throw new Error(`agent '${localAgentId}' is not back-linked to a marketplace source`);
        }
        const m = await db
            .selectFrom('marketplace_agents')
            .select(['version'])
            .where('id', '=', agent.marketplace_source_id)
            .executeTakeFirst();
        if (!m) throw new MarketplaceNotFoundError(agent.marketplace_source_id);
        await db
            .updateTable('agents')
            .set({ marketplace_pulled_version: m.version })
            .where('id', '=', localAgentId)
            .execute();
        const refreshed = await agentsService.get(localAgentId);
        return refreshed!;
    },

    // Imports an agent bundle (uploaded zip) as a new LOCAL agent. The
    // imported agent is intentionally NOT back-linked to the marketplace:
    // bundles come from "somewhere else" (a colleague, an export file)
    // and should not trigger catalog-upgrade prompts. If the Owner wants
    // upgrade tracking, they should Add from the marketplace instead.
    async importBundle(
        bundle: AgentBundle,
        options: { agent_id?: string | undefined } = {},
    ): Promise<IAgent> {
        const m = bundle.manifest;
        const id = (options.agent_id && options.agent_id.trim()) || m.id;
        const existing = await agentsService.get(id);
        if (existing) {
            throw new MarketplaceSlugTakenError(id, suggestAlternateSlug(m.id));
        }
        return await db.transaction().execute(async (trx) => {
            await trx
                .insertInto('agents')
                .values({
                    id,
                    name: m.name,
                    category: m.category,
                    cli: m.cli,
                    model: m.model,
                    effort: m.effort,
                    framework: m.framework,
                    prompt_md: bundle.prompt_md,
                    prompt_version: 1,
                    handoff_prompt_md: m.handoff_prompt_md,
                    status: m.status,
                    accent_color: m.accent_color,
                    sort_order: m.sort_order,
                    description: m.description,
                    designation: m.designation,
                    role_id: m.role_id,
                    max_rounds: m.max_rounds,
                    requires_item: m.requires_item,
                    schedule_hours: m.schedule_hours,
                    schedule_preset: m.schedule_preset,
                    schedule_time_of_day: m.schedule_time_of_day,
                    schedule_weekdays: m.schedule_weekdays,
                    schedule_day_of_month: m.schedule_day_of_month,
                    concurrent_runs: m.concurrent_runs,
                    glyph: m.glyph,
                    memory_cadence: m.memory_cadence,
                    kind_slug: m.kind_slug,
                    settings_json: m.settings_json,
                    cron_expr: m.cron_expr,
                    raises_pr: m.raises_pr,
                    push_code: m.push_code,
                    requires_worktree: m.requires_worktree,
                    marketplace_source_id: null,
                    marketplace_pulled_version: null,
                })
                .execute();
            await trx
                .insertInto('agent_prompt_versions')
                .values({
                    agent_id: id,
                    version: 1,
                    body_md: bundle.prompt_md,
                    edited_by: 'Import',
                })
                .execute();
            await trx
                .insertInto('agent_memory')
                .values({
                    agent_id: id,
                    body_md: bundle.memory_md,
                    version: 1,
                    source: 'manual-edit' as const,
                })
                .execute();
            if (bundle.handoff_rules.length > 0) {
                await trx
                    .insertInto('agent_handoff_rules')
                    .values(
                        bundle.handoff_rules.map((h) => ({
                            agent_id: id,
                            target_agent_id: h.target_agent_id,
                            kind: h.kind,
                            status: h.status,
                        })),
                    )
                    .execute();
            }
            if (bundle.checklists.length > 0) {
                await trx
                    .insertInto('agent_checklists')
                    .values(
                        bundle.checklists.map((c) => ({
                            agent_id: id,
                            label: c.label,
                            sort_order: c.sort_order,
                            required: c.required,
                        })),
                    )
                    .execute();
            }
            const row = await trx
                .selectFrom('agents')
                .selectAll()
                .where('id', '=', id)
                .executeTakeFirstOrThrow();
            return row as unknown as IAgent;
        });
    },

    async detach(localAgentId: string): Promise<IAgent> {
        const agent = await agentsService.get(localAgentId);
        if (!agent) throw new MarketplaceNotFoundError(localAgentId);
        await db
            .updateTable('agents')
            .set({ marketplace_source_id: null, marketplace_pulled_version: null })
            .where('id', '=', localAgentId)
            .execute();
        const refreshed = await agentsService.get(localAgentId);
        return refreshed!;
    },
};
