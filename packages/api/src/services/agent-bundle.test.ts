import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
    packAgentBundle,
    unpackAgentBundle,
    AgentBundleParseError,
    type AgentBundle,
} from './agent-bundle.js';

const FIXTURE: AgentBundle = {
    manifest: {
        id: 'agent-fixture',
        name: 'Fixture',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: 'fixture',
        description: 'A fixture agent used by tests',
        designation: 'Test fixture',
        accent_color: '#007AC9',
        sort_order: 99,
        glyph: 'science',
        role_id: null,
        max_rounds: 5,
        requires_item: true,
        requires_worktree: false,
        push_code: false,
        raises_pr: false,
        status: 'active',
        kind_slug: 'custom',
        settings_json: { canary: true, depth: 3 },
        schedule_hours: 6,
        schedule_preset: 'every_n_hours',
        schedule_time_of_day: null,
        schedule_weekdays: null,
        schedule_day_of_month: null,
        cron_expr: null,
        concurrent_runs: 1,
        memory_cadence: 1,
        effort: 'medium',
        handoff_prompt_md: 'When done, hand back to Owner.',
        summary: 'A fixture agent used by tests',
        version: 1,
        published_at: '2026-06-03T00:00:00Z',
    },
    prompt_md: '# Fixture\n\nYou are a fixture agent.\n',
    memory_md: '## Memory\n- nothing yet\n',
    handoff_rules: [{ target_agent_id: 'owner', kind: 'on-pass', status: 'done' }],
    checklists: [{ label: 'Checked', sort_order: 0, required: true }],
};

describe('agent-bundle pack/unpack', () => {
    it('round-trips a complete bundle losslessly', async () => {
        const zip = await packAgentBundle(FIXTURE);
        const out = await unpackAgentBundle(zip);
        expect(out.manifest).toEqual(FIXTURE.manifest);
        expect(out.prompt_md).toBe(FIXTURE.prompt_md);
        expect(out.memory_md).toBe(FIXTURE.memory_md);
        expect(out.handoff_rules).toEqual(FIXTURE.handoff_rules);
        expect(out.checklists).toEqual(FIXTURE.checklists);
    });

    it('rejects a non-zip buffer with AgentBundleParseError', async () => {
        await expect(unpackAgentBundle(Buffer.from('not a zip'))).rejects.toBeInstanceOf(
            AgentBundleParseError,
        );
    });

    it('rejects a zip whose manifest fails validation', async () => {
        const broken: AgentBundle = {
            ...FIXTURE,
            manifest: { ...FIXTURE.manifest, accent_color: '' as never },
        };
        const zip = await packAgentBundle(broken);
        await expect(unpackAgentBundle(zip)).rejects.toBeInstanceOf(AgentBundleParseError);
    });

    it('treats missing optional files (memory, handoffs, checklists) as empty', async () => {
        const minimal = await packAgentBundle({
            ...FIXTURE,
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        });
        const out = await unpackAgentBundle(minimal);
        expect(out.memory_md).toBe('');
        expect(out.handoff_rules).toEqual([]);
        expect(out.checklists).toEqual([]);
    });

    it('rejects a bundle missing the required manifest.json entry', async () => {
        const zip = new JSZip();
        zip.file('prompt.md', 'hi');
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        await expect(unpackAgentBundle(buf)).rejects.toThrow(/missing required entry/);
    });

    it('rejects a bundle whose manifest.json is not valid JSON', async () => {
        const zip = new JSZip();
        zip.file('manifest.json', '{ not valid json');
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        await expect(unpackAgentBundle(buf)).rejects.toThrow(/not valid JSON/);
    });

    it('rejects a bundle whose handoff_rules.json fails schema validation', async () => {
        const goodZip = await packAgentBundle(FIXTURE);
        const zip = await JSZip.loadAsync(goodZip);
        zip.file('handoff_rules.json', JSON.stringify([{ wrong: 'shape' }]));
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        await expect(unpackAgentBundle(buf)).rejects.toThrow(/handoff_rules\.json failed validation/);
    });

    it('rejects a bundle whose checklists.json fails schema validation', async () => {
        const goodZip = await packAgentBundle(FIXTURE);
        const zip = await JSZip.loadAsync(goodZip);
        zip.file('checklists.json', JSON.stringify([{ label: 1, sort_order: 'no', required: 'yes' }]));
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        await expect(unpackAgentBundle(buf)).rejects.toThrow(/checklists\.json failed validation/);
    });

    it('defaults effort to medium when manifest omits it (pre-Task-6 bundle)', async () => {
        const goodZip = await packAgentBundle(FIXTURE);
        const zip = await JSZip.loadAsync(goodZip);
        const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Record<string, unknown>;
        delete manifest['effort'];
        zip.file('manifest.json', JSON.stringify(manifest));
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        const out = await unpackAgentBundle(buf);
        expect(out.manifest.effort).toBe('medium');
    });

    // readZipFile: the required=false + file-absent path returns null, which
    // triggers the `handoffParsed ?? []` and `checklistParsed ?? []` null-path arms.
    it('falls back to empty arrays when handoff_rules.json is absent from zip', async () => {
        const zip = new JSZip();
        const manifest = { ...FIXTURE.manifest };
        zip.file('manifest.json', JSON.stringify(manifest));
        zip.file('prompt.md', FIXTURE.prompt_md);
        // memory.md and handoff_rules.json and checklists.json are intentionally omitted.
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        const out = await unpackAgentBundle(buf);
        expect(out.handoff_rules).toEqual([]);
        expect(out.checklists).toEqual([]);
        expect(out.memory_md).toBe('');
    });

    // readZipFile: required=false + file absent → null → covered by above; but
    // also covers the `handoffParsed && !handoffParsed.success` false branch
    // (handoffParsed is null → short-circuit) and same for checklists.
    it('populates prompt_md from zip when present', async () => {
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify(FIXTURE.manifest));
        zip.file('prompt.md', '# Hello\n');
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        const out = await unpackAgentBundle(buf);
        expect(out.prompt_md).toBe('# Hello\n');
    });
});
