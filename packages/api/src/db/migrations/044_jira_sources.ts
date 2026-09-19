import type { Knex } from 'knex';

// ADR 0017 — the Jira bridge reads one JQL per repo ("sources") instead of one
// JQL routed by label rules. The old config converts without changing what an
// issue becomes: each label rule turns into `(<jql>) AND labels = "<label>"`
// for the rule's project (a primary repo's id is its project id), in rule
// order, then the plain JQL for the default project catches the rest. The
// first matching source picks the project, as the first matching rule did.

interface Source {
    repo_id: string;
    jql: string;
    workflow_id: string | null;
}

interface OldRule {
    label: string;
    project_id?: string | null;
    workflow_id?: string | null;
}

const jqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// JQL allows ORDER BY only at the very end, outside any parentheses, so it is
// split off before a query is wrapped and put back after.
function splitOrderBy(jql: string): { where: string; order: string } {
    const m = /\s*\bORDER\s+BY\b[\s\S]*$/i.exec(jql);
    return m
        ? { where: jql.slice(0, m.index).trim(), order: m[0].trim() }
        : { where: jql.trim(), order: '' };
}

function withClause(jql: string, clause: string): string {
    const { where, order } = splitOrderBy(jql);
    return [where ? `(${where}) AND ${clause}` : clause, order].filter(Boolean).join(' ');
}

function sourcesFromOldConfig(
    jql: string | null,
    projectId: string | null,
    rules: OldRule[]
): Source[] {
    const base = jql?.trim();
    if (!base) return [];
    const out: Source[] = [];
    for (const r of rules) {
        const repoId = r.project_id ?? projectId;
        if (!repoId) continue;
        out.push({
            repo_id: repoId,
            jql: withClause(base, `labels = ${jqlString(r.label)}`),
            workflow_id: r.workflow_id ?? null,
        });
    }
    if (projectId) out.push({ repo_id: projectId, jql: base, workflow_id: null });
    return out;
}

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(
        `ALTER TABLE public.jira_config ADD COLUMN sources jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    const row = (await knex('jira_config')
        .select('jql', 'project_id', 'label_workflows')
        .where('id', 1)
        .first()) as
        { jql: string | null; project_id: string | null; label_workflows: OldRule[] } | undefined;
    if (row) {
        const sources = sourcesFromOldConfig(row.jql, row.project_id, row.label_workflows);
        await knex('jira_config')
            .where('id', 1)
            .update({ sources: JSON.stringify(sources) });
    }
    await knex.schema.raw(`
        ALTER TABLE public.jira_config
            DROP COLUMN jql,
            DROP COLUMN project_id,
            DROP COLUMN label_workflows
    `);
}

// Best effort: the sources' queries OR'd into one JQL for the first source's
// project; per-repo routing and workflows are lost.
export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.jira_config
            ADD COLUMN jql text,
            ADD COLUMN project_id text REFERENCES public.projects(id) ON DELETE SET NULL,
            ADD COLUMN label_workflows jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    const row = (await knex('jira_config').select('sources').where('id', 1).first()) as
        { sources: Source[] } | undefined;
    const first = row?.sources[0];
    if (row && first) {
        const owner = (await knex.raw(
            `SELECT COALESCE(
                (SELECT project_id FROM public.project_repos WHERE id = ?),
                (SELECT id FROM public.projects WHERE id = ?)
            ) AS project_id`,
            [first.repo_id, first.repo_id]
        )) as { rows: { project_id: string | null }[] };
        await knex('jira_config')
            .where('id', 1)
            .update({
                jql: [
                    row.sources
                        .map((s) => `(${splitOrderBy(s.jql).where || 'created IS NOT EMPTY'})`)
                        .join(' OR '),
                    splitOrderBy(first.jql).order,
                ]
                    .filter(Boolean)
                    .join(' '),
                project_id: owner.rows[0]?.project_id ?? null,
            });
    }
    await knex.schema.raw(`ALTER TABLE public.jira_config DROP COLUMN sources`);
}
