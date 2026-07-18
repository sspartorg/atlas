import type { IAgent, IssueType } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { guardrailsService } from './guardrails.js';
import { buildConstitutionMarkdown, buildPrompt } from './prompt-builder.js';

export interface CompilePromptResult {
    prompt: string;
    filename: string;
    length: number;
    agent: { id: string; name: string; cli: string; model: string };
    // `null` for freedom-mode runs (`requires_item = false`) — the prompt
    // builder skips item context entirely and the response carries no
    // issue identity.
    issue: { type: IssueType; id: string; title: string } | null;
    guardrails_count: number;
    sections: string[];
}

function timestampSuffix(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}

function slugify(s: string): string {
    return (
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'agent'
    );
}

async function getIssueTitle(issueType: IssueType, issueId: string): Promise<string | null> {
    const row = await db
        .selectFrom('items')
        .select('title')
        .where('id', '=', issueId)
        .where('type', '=', issueType)
        .executeTakeFirst();
    return (row?.title as string | null) ?? null;
}

function detectSections(prompt: string): string[] {
    const headers: string[] = [];
    for (const line of prompt.split('\n')) {
        if (line.startsWith('# ')) headers.push(line.slice(2).trim());
    }
    return headers;
}

export async function compilePromptFor(
    agent: IAgent,
    issueType: IssueType | null,
    issueId: string | null
): Promise<CompilePromptResult> {
    const isFreedom = !issueType || !issueId;

    const [rules, issueTitle] = await Promise.all([
        guardrailsService.list(),
        isFreedom ? Promise.resolve(null) : getIssueTitle(issueType!, issueId!),
    ]);
    if (!isFreedom && issueTitle === null) {
        throw new Error(`Issue ${issueType}/${issueId} not found`);
    }

    const constitutionMd = buildConstitutionMarkdown(rules);
    const prompt = await buildPrompt({
        agent,
        issueType: isFreedom ? null : issueType!,
        issueId: isFreedom ? null : issueId!,
        constitutionMd,
    });

    const filename = isFreedom
        ? `prompt-${slugify(agent.name)}-freedom-${timestampSuffix(new Date())}.md`
        : `prompt-${slugify(agent.name)}-${issueType}-${issueId}-${timestampSuffix(new Date())}.md`;

    return {
        prompt,
        filename,
        length: prompt.length,
        agent: {
            id: agent.id,
            name: agent.name,
            cli: agent.cli,
            model: agent.model,
        },
        issue: isFreedom
            ? null
            : { type: issueType!, id: issueId!, title: issueTitle! },
        guardrails_count: rules.length,
        sections: detectSections(prompt),
    };
}
