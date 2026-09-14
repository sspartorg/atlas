// Agent bundle pack/unpack. The zip format round-trips losslessly with the
// on-disk catalog folder layout (manifest.json + prompt.md + memory.md +
// checklists.json), so the same parsing code serves
// both "export from local DB" and "fetch from marketplace catalog".

import JSZip from 'jszip';
import { z } from 'zod';
import type {
    AgentCategory,
    AgentCli,
    AgentKindSlug,
    AgentStatus,
    IAgentBundleManifest,
    IMarketplaceAgentChecklist,
    SdlcRole,
} from '@atlas/shared';
import { AGENT_CLIS } from '@atlas/shared';

const AGENT_CATEGORY_VALUES: readonly AgentCategory[] = [
    'software-dev',
    'marketing',
    'content',
    'design',
];
const AGENT_CLI_VALUES: readonly AgentCli[] = AGENT_CLIS;
const AGENT_STATUS_VALUES: readonly AgentStatus[] = ['active', 'inactive'];
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
    status: z.enum(AGENT_STATUS_VALUES as readonly [AgentStatus, ...AgentStatus[]]),
    kind_slug: z.enum(AGENT_KIND_SLUG_VALUES as readonly [AgentKindSlug, ...AgentKindSlug[]]),
    settings_json: z.record(z.string(), z.unknown()),
    memory_cadence: z.number().int().min(1).max(100),
    summary: z.string(),
    version: z.number().int().min(1),
    published_at: z.string(),
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

    return { manifest, prompt_md, memory_md, checklists };
}
