import type { Knex } from 'knex';

// `jira_sources` — the Jira bridge's query+workflow+repos combos, moved off
// the singleton `jira_config.sources` jsonb array onto their own table, keyed
// by project.
//
// Why a table and not jsonb on a per-project row:
//
// 1. **The global order survives.** Matching is order-dependent: an issue
//    matching several sources becomes ONE Task (`jira_issues` is keyed by
//    `jira_key`) in the project of the FIRST source it matched. One global
//    array made "first" well defined; per-project arrays would destroy it and
//    leave the tie-break to be invented from something arbitrary like a
//    project's created_at. A `serial` gives a total order across every
//    project for free, and backfilling in array order below reproduces
//    today's routing exactly. Because new rows always sort last, adding a
//    source to a second project can never hijack routing an existing source
//    already owns.
//
// 2. **The DB does the deletes.** `project_id` cascades and `workflow_id`
//    nulls out — the same FK pair `items` uses — so the whole "this source
//    points at something that no longer exists" class is gone rather than
//    guarded in app code.
//
// 3. **Stable ids let the UI edit ONE source.** The old shape was
//    read-modify-write over a shared array: two open tabs stomped each other,
//    and delete-then-re-add silently moved a source to the END of the global
//    order — i.e. quietly changed which project an ambiguous issue lands in.
//
// `repo_id` becomes `repo_ids[]`. That is a deletion, not an addition: the
// only reason the union logic existed (`distinctRepos`, plus the two "matched
// repos of that project" passes) is that a source could name just one repo.
// One source carrying its own repos is the combo the Owner asked for.
//
// `jira_issues` and `items` are deliberately NOT touched. Dedup is by
// `jira_key`, so every already-imported issue keeps its Task and its project
// whatever the new routing would say.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS jira_sources (
            id serial PRIMARY KEY,
            project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            jql text NOT NULL,
            workflow_id text REFERENCES workflows(id) ON DELETE SET NULL,
            repo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_jira_sources_project_id ON jira_sources(project_id)`
    );

    // ORDER BY s.ord is what makes the new serial monotonic in the old array's
    // order, so the lowest-id-wins tie-break reproduces the old
    // first-match-wins byte for byte.
    //
    // The JOIN drops a source whose repo is already gone. Those are dead
    // today too — `pull` skips them and names them in last_sync_message.
    await knex.raw(`
        INSERT INTO jira_sources (project_id, jql, workflow_id, repo_ids)
        SELECT r.project_id,
               s.value->>'jql',
               s.value->>'workflow_id',
               jsonb_build_array(s.value->'repo_id')
        FROM jira_config c
        CROSS JOIN LATERAL jsonb_array_elements(c.sources) WITH ORDINALITY AS s(value, ord)
        JOIN project_repos r ON r.id = s.value->>'repo_id'
        WHERE c.id = 1
        ORDER BY s.ord
    `);

    await knex.raw(`ALTER TABLE jira_config DROP COLUMN IF EXISTS sources`);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(
        `ALTER TABLE jira_config ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    // A multi-repo source collapses back to its first repo — the old shape
    // could not express more than one.
    await knex.raw(`
        UPDATE jira_config SET sources = COALESCE((
            SELECT jsonb_agg(
                       jsonb_build_object(
                           'repo_id', s.repo_ids->>0,
                           'jql', s.jql,
                           'workflow_id', s.workflow_id
                       ) ORDER BY s.id
                   )
            FROM jira_sources s
        ), '[]'::jsonb)
        WHERE id = 1
    `);
    await knex.raw(`DROP TABLE IF EXISTS jira_sources`);
}
