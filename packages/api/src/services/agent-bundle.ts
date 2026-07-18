// Agent bundle pack/unpack. The zip format round-trips losslessly with the
// on-disk catalog folder layout (manifest.json + prompt.md + memory.md +
// handoff_rules.json + checklists.json), so the same parsing code serves
// both "export from local DB" and "fetch from marketplace catalog".

import JSZip from 'jszip';
import { z } from 'zod';
import type {
    AgentCategory,
    AgentCli,
    AgentKindSlug,
    AgentSchedulePreset,
    AgentStatus,
    IAgentBundleManifest,
    IMarketplaceAgentChecklist,
    IMarketplaceAgentHandoff,
    SdlcRole,
} from '@atlas/shared';

const AGENT_CATEGORY_VALUES: readonly AgentCategory[] = [
    'software-dev',
    'marketing',
    'content',
    'design',
];
const AGENT_CLI_VALUES: readonly AgentCli[] = ['claude', 'copilot'];
const AGENT_STATUS_VALUES: readonly AgentStatus[] = ['active', 'inactive'];
const AGENT_SCHEDULE_PRESET_VALUES: readonly AgentSchedulePreset[] = [
    'every_n_hours',
    'daily',
    'weekly',
    'monthly',
];
const AGENT_KIND_SLUG_VALUES: readonly AgentKindSlug[] = [
    'ai-news',
    'market-research',
    'regulations',
    'jira-to-epic',
    'ai-readiness',
    'knowledge-base',
    'custom',
];
const SDLC_ROLE_VALUES: readonly SdlcRole[] = ['po', 'architect', 'engineer', 'qa', 'automation'];

const AgentBundleManifestSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(AGENT_CATEGORY_VALUES as readonly [AgentCategory, ...AgentCategory[]]),
    cli: z.enum(AGENT_CLI_VALUES as readonly [AgentCli, ...AgentCli[]]),
    model: z.string().min(1),
    // Task 6 — reasoning-effort knob. Optional on disk-shaped manifests
    // so pre-Task-6 bundles still load; defaults to 'medium' to match
    // the DB column default applied by migration 082.
    effort: z
        .enum(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
        .default('medium'),
    framework: z.string(),
    description: z.string(),
    designation: z.string(),
    accent_color: z.string().min(1),
    sort_order: z.number().int(),
    glyph: z.string(),
    role_id: z
        .enum(SDLC_ROLE_VALUES as readonly [SdlcRole, ...SdlcRole[]])
        .nullable(),
    max_rounds: z.number().int().min(1).max(100),
    requires_item: z.boolean(),
    requires_worktree: z.boolean(),
    push_code: z.boolean(),
    raises_pr: z.boolean(),
    status: z.enum(AGENT_STATUS_VALUES as readonly [AgentStatus, ...AgentStatus[]]),
    kind_slug: z.enum(AGENT_KIND_SLUG_VALUES as readonly [AgentKindSlug, ...AgentKindSlug[]]),
    settings_json: z.record(z.string(), z.unknown()),
    schedule_hours: z.number().min(0),
    schedule_preset: z.enum(
        AGENT_SCHEDULE_PRESET_VALUES as readonly [AgentSchedulePreset, ...AgentSchedulePreset[]],
    ),
    schedule_time_of_day: z.string().nullable(),
    schedule_weekdays: z.array(z.number().int().min(1).max(7)).nullable(),
    schedule_day_of_month: z.number().int().min(1).max(31).nullable(),
    cron_expr: z.string().nullable(),
    concurrent_runs: z.number().int().min(1),
    memory_cadence: z.number().int().min(1).max(100),
    handoff_prompt_md: z.string(),
    summary: z.string(),
    version: z.number().int().min(1),
    published_at: z.string(),
});

const HandoffSchema = z.object({
    target_agent_id: z.string(),
    kind: z.enum(['on-pass', 'on-fail']),
    status: z.string(),
});

const ChecklistSchema = z.object({
    label: z.string(),
    sort_order: z.number().int(),
    required: z.boolean(),
});

export interface AgentBundle {
    manifest: IAgentBundleManifest;
    prompt_md: string;
    memory_md: string;
    handoff_rules: IMarketplaceAgentHandoff[];
    checklists: IMarketplaceAgentChecklist[];
}

export class AgentBundleParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentBundleParseError';
    }
}

export async function packAgentBundle(bundle: AgentBundle): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(bundle.manifest, null, 2) + '\n');
    zip.file('prompt.md', bundle.prompt_md);
    zip.file('memory.md', bundle.memory_md);
    zip.file('handoff_rules.json', JSON.stringify(bundle.handoff_rules, null, 2) + '\n');
    zip.file('checklists.json', JSON.stringify(bundle.checklists, null, 2) + '\n');
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function readZipFile(zip: JSZip, name: string, required: true): Promise<string>;
async function readZipFile(zip: JSZip, name: string, required: false): Promise<string | null>;
async function readZipFile(zip: JSZip, name: string, required: boolean): Promise<string | null> {
    const file = zip.file(name);
    if (!file) {
        if (required) throw new AgentBundleParseError(`missing required entry '${name}' in agent bundle`);
        return null;
    }
    return await file.async('string');
}

export async function unpackAgentBundle(zipData: Buffer | Uint8Array): Promise<AgentBundle> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(zipData);
    } catch (err) {
        throw new AgentBundleParseError(
            `agent bundle is not a valid zip archive: ${(err as Error).message}`,
        );
    }

    const manifestRaw = await readZipFile(zip, 'manifest.json', true);
    let manifestJson: unknown;
    try {
        manifestJson = JSON.parse(manifestRaw);
    } catch (err) {
        throw new AgentBundleParseError(
            `manifest.json is not valid JSON: ${(err as Error).message}`,
        );
    }
    const manifestResult = AgentBundleManifestSchema.safeParse(manifestJson);
    if (!manifestResult.success) {
        throw new AgentBundleParseError(
            `manifest.json failed validation: ${manifestResult.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; ')}`,
        );
    }
    const manifest = manifestResult.data as IAgentBundleManifest;

    const prompt_md = (await readZipFile(zip, 'prompt.md', false)) ?? '';
    const memory_md = (await readZipFile(zip, 'memory.md', false)) ?? '';

    const handoffRaw = await readZipFile(zip, 'handoff_rules.json', false);
    const handoffParsed = handoffRaw
        ? z.array(HandoffSchema).safeParse(JSON.parse(handoffRaw))
        : null;
    if (handoffParsed && !handoffParsed.success) {
        throw new AgentBundleParseError(
            `handoff_rules.json failed validation: ${handoffParsed.error.message}`,
        );
    }
    const handoff_rules = (handoffParsed?.data ?? []) as IMarketplaceAgentHandoff[];

    const checklistRaw = await readZipFile(zip, 'checklists.json', false);
    const checklistParsed = checklistRaw
        ? z.array(ChecklistSchema).safeParse(JSON.parse(checklistRaw))
        : null;
    if (checklistParsed && !checklistParsed.success) {
        throw new AgentBundleParseError(
            `checklists.json failed validation: ${checklistParsed.error.message}`,
        );
    }
    const checklists = (checklistParsed?.data ?? []) as IMarketplaceAgentChecklist[];

    return { manifest, prompt_md, memory_md, handoff_rules, checklists };
}
