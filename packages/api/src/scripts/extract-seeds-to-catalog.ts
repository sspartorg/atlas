// One-shot extractor: walks AGENT_SEEDS / HANDOFF_RULE_SEEDS / CHECKLIST_SEEDS
// from the legacy seed module and writes one catalog folder per agent into
// packages/api/src/marketplace/catalog/<id>/. Idempotent — overwrites
// existing files. Run once on the migration to baseline the catalog from
// today's seed truth; future catalog edits are made directly in the files.
//
//   pnpm tsx packages/api/src/scripts/extract-seeds-to-catalog.ts
//
// After running, commit the catalog folder and update seed.ts to read it
// instead of the hardcoded constants.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_SEEDS, HANDOFF_RULE_SEEDS, CHECKLIST_SEEDS } from '../db/seed.js';
import type { IAgentBundleManifest } from '@atlas/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_ROOT = resolve(__dirname, '..', 'marketplace', 'catalog');

function shortSummary(description: string): string {
    const firstSentence = description.split(/(?<=[.!?])\s+/)[0] ?? description;
    return firstSentence.length > 220 ? firstSentence.slice(0, 217) + '...' : firstSentence;
}

function manifestFor(agent: (typeof AGENT_SEEDS)[number]): IAgentBundleManifest {
    return {
        id: agent.id,
        name: agent.name,
        category: agent.category,
        cli: agent.cli,
        model: agent.model,
        effort: (agent as { effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }).effort ?? 'medium',
        framework: agent.framework,
        description: agent.description,
        designation: agent.designation,
        accent_color: agent.accent_color,
        sort_order: agent.sort_order,
        glyph: agent.glyph,
        role_id: agent.role_id ?? null,
        max_rounds: agent.max_rounds,
        requires_item: agent.requires_item,
        requires_worktree: agent.requires_worktree ?? false,
        push_code: agent.push_code ?? false,
        raises_pr: agent.raises_pr ?? false,
        status: agent.status,
        kind_slug: agent.kind_slug ?? 'custom',
        settings_json: agent.settings_json ?? {},
        schedule_hours: agent.schedule_hours ?? 6,
        schedule_preset: agent.schedule_preset ?? 'every_n_hours',
        schedule_time_of_day: agent.schedule_time_of_day ?? null,
        schedule_weekdays: null,
        schedule_day_of_month: null,
        cron_expr: agent.cron_expr ?? null,
        concurrent_runs: agent.concurrent_runs,
        memory_cadence: 1,
        handoff_prompt_md: agent.handoff_prompt_md,
        summary: shortSummary(agent.description),
        version: 1,
        published_at: '2026-06-03T00:00:00Z',
    };
}

function main(): void {
    mkdirSync(CATALOG_ROOT, { recursive: true });

    for (const agent of AGENT_SEEDS) {
        const dir = join(CATALOG_ROOT, agent.id);
        mkdirSync(dir, { recursive: true });

        const manifest = manifestFor(agent);
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        writeFileSync(join(dir, 'prompt.md'), agent.prompt_md, 'utf8');
        writeFileSync(join(dir, 'memory.md'), '', 'utf8');

        const handoffs = HANDOFF_RULE_SEEDS.filter((h) => h.agent_id === agent.id).map((h) => ({
            target_agent_id: h.target_agent_id,
            kind: h.kind,
            status: h.status,
        }));
        writeFileSync(join(dir, 'handoff_rules.json'), JSON.stringify(handoffs, null, 2) + '\n', 'utf8');

        const checklists = CHECKLIST_SEEDS.filter((c) => c.agent_id === agent.id).map((c) => ({
            label: c.label,
            sort_order: c.sort_order,
            required: c.required,
        }));
        writeFileSync(join(dir, 'checklists.json'), JSON.stringify(checklists, null, 2) + '\n', 'utf8');

        console.log(`  ✓ ${agent.id}  (${handoffs.length} handoffs, ${checklists.length} checklists)`);
    }

    console.log(`\n[catalog] wrote ${AGENT_SEEDS.length} agents under ${CATALOG_ROOT}`);
}

main();
