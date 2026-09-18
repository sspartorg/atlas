import type { Knex } from 'knex';

// ADR 0015 — two item kinds: a Task (top level) and its Sub-tasks. Stories,
// bugs and sub-bugs go away:
//   epic               → task
//   story / bug        → sub_task under the same parent
//   sub_task / sub_bug → sub_task under its story's task (one level up)
// Bug-only fields are folded into the description, then dropped.
//
// `type` / `parent_type` move from the item_type enum to text + CHECK — Postgres
// can't drop enum values, and 020 / 035 already use CHECK for the same reason.
//
// `created_by_workflow_run_id` (035) only fed End-node child routing, which a
// Task workflow replaces with its Sub-tasks step (ADR 0015).

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        -- A column-specific trigger blocks ALTER COLUMN TYPE; recreated below.
        DROP TRIGGER items_check_parent ON public.items;

        ALTER TABLE public.items
            ALTER COLUMN type TYPE text USING type::text,
            ALTER COLUMN parent_type TYPE text USING parent_type::text;

        -- Grandchildren first, while their story parent still says 'story'.
        UPDATE public.items c
           SET parent_id = s.parent_id
          FROM public.items s
         WHERE c.parent_id = s.id
           AND c.type IN ('sub_task', 'sub_bug')
           AND s.type = 'story';

        UPDATE public.items
           SET description = concat_ws(E'\\n\\n',
                   NULLIF(description, ''),
                   CASE WHEN COALESCE(steps_to_reproduce, '') <> '' THEN E'### Steps to reproduce\\n' || steps_to_reproduce END,
                   CASE WHEN COALESCE(expected, '') <> '' THEN E'### Expected\\n' || expected END,
                   CASE WHEN COALESCE(actual, '') <> '' THEN E'### Actual\\n' || actual END)
         WHERE type IN ('bug', 'sub_bug');

        UPDATE public.items SET type = 'task', parent_type = NULL WHERE type = 'epic';
        UPDATE public.items SET type = 'sub_task', parent_type = 'task' WHERE type IN ('story', 'bug', 'sub_task', 'sub_bug');

        ALTER TABLE public.items
            ADD CONSTRAINT items_type_check CHECK (type IN ('task', 'sub_task')),
            ADD CONSTRAINT items_parent_type_check CHECK (parent_type IS NULL OR parent_type = 'task'),
            DROP CONSTRAINT IF EXISTS items_failure_scope_check,
            DROP CONSTRAINT IF EXISTS items_frequency_check,
            DROP COLUMN steps_to_reproduce,
            DROP COLUMN expected,
            DROP COLUMN actual,
            DROP COLUMN frequency,
            DROP COLUMN failure_scope,
            DROP COLUMN detected_at,
            DROP COLUMN occurrence_count,
            DROP COLUMN occurrence_total,
            DROP COLUMN IF EXISTS created_by_workflow_run_id;

        -- Sub-tasks are run by their Task's workflow; they are never queued
        -- for a workflow of their own.
        UPDATE public.items SET workflow_id = NULL WHERE type = 'sub_task';

        CREATE OR REPLACE FUNCTION public.items_check_parent() RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            DECLARE
                real_parent_type text;
            BEGIN
                IF NEW.type = 'task' THEN
                    IF NEW.parent_id IS NOT NULL OR NEW.parent_type IS NOT NULL THEN
                        RAISE EXCEPTION 'Task items must have NULL parent_id and parent_type';
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.parent_id IS NULL THEN
                    RAISE EXCEPTION 'Sub-tasks require parent_id';
                END IF;

                SELECT type INTO real_parent_type FROM items WHERE id = NEW.parent_id;
                IF real_parent_type IS NULL THEN
                    RAISE EXCEPTION 'parent_id % does not exist', NEW.parent_id;
                END IF;
                IF real_parent_type <> 'task' THEN
                    RAISE EXCEPTION 'Sub-tasks must be parented to a task (got %)', real_parent_type;
                END IF;

                NEW.parent_type := real_parent_type;
                RETURN NEW;
            END;
            $$;

        CREATE TRIGGER items_check_parent BEFORE INSERT OR UPDATE OF parent_id, type ON public.items FOR EACH ROW EXECUTE FUNCTION public.items_check_parent();

        DROP TYPE public.item_type;

        -- Stored deep links point at the retired per-kind pages.
        UPDATE public.notifications
           SET link_url = regexp_replace(link_url, '^/epics/', '/tasks/')
         WHERE link_url LIKE '/epics/%';
        UPDATE public.notifications
           SET link_url = regexp_replace(link_url, '^/issues/(stories|bugs|sub-tasks|sub-bugs)/', '/sub-tasks/')
         WHERE link_url ~ '^/issues/(stories|bugs|sub-tasks|sub-bugs)/';
    `);
}

// Best-effort: tasks become epics and every sub-task becomes a story. The
// dropped bug columns come back empty; their text stays in the description.
export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TYPE public.item_type AS ENUM ('epic', 'story', 'sub_task', 'sub_bug', 'bug');

        DROP TRIGGER items_check_parent ON public.items;

        ALTER TABLE public.items
            DROP CONSTRAINT items_type_check,
            DROP CONSTRAINT items_parent_type_check;

        UPDATE public.items SET type = 'epic', parent_type = NULL WHERE type = 'task';
        UPDATE public.items SET type = 'story', parent_type = 'epic' WHERE type = 'sub_task';

        ALTER TABLE public.items
            ALTER COLUMN type TYPE public.item_type USING type::public.item_type,
            ALTER COLUMN parent_type TYPE public.item_type USING parent_type::public.item_type,
            ADD COLUMN steps_to_reproduce text,
            ADD COLUMN expected text,
            ADD COLUMN actual text,
            ADD COLUMN frequency text,
            ADD COLUMN failure_scope text,
            ADD COLUMN detected_at timestamp with time zone,
            ADD COLUMN occurrence_count integer,
            ADD COLUMN occurrence_total integer,
            ADD COLUMN created_by_workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
            ADD CONSTRAINT items_failure_scope_check CHECK (((failure_scope IS NULL) OR (failure_scope = ANY (ARRAY['data-loss'::text, 'functional'::text, 'cosmetic'::text, 'performance'::text])))),
            ADD CONSTRAINT items_frequency_check CHECK (((frequency IS NULL) OR (frequency = ANY (ARRAY['always'::text, 'sometimes'::text, 'rare'::text]))));

        CREATE OR REPLACE FUNCTION public.items_check_parent() RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            DECLARE
                real_parent_type item_type;
            BEGIN
                IF NEW.type = 'epic' THEN
                    IF NEW.parent_id IS NOT NULL OR NEW.parent_type IS NOT NULL THEN
                        RAISE EXCEPTION 'Epic items must have NULL parent_id and parent_type';
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.parent_id IS NULL THEN
                    RAISE EXCEPTION 'Non-epic items require parent_id (type=%)', NEW.type;
                END IF;

                SELECT type INTO real_parent_type FROM items WHERE id = NEW.parent_id;
                IF real_parent_type IS NULL THEN
                    RAISE EXCEPTION 'parent_id % does not exist', NEW.parent_id;
                END IF;

                IF NEW.type IN ('story','bug') AND real_parent_type <> 'epic' THEN
                    RAISE EXCEPTION '% items must be parented to an epic (got %)', NEW.type, real_parent_type;
                END IF;
                IF NEW.type IN ('sub_task','sub_bug') AND real_parent_type <> 'story' THEN
                    RAISE EXCEPTION '% items must be parented to a story (got %)', NEW.type, real_parent_type;
                END IF;

                NEW.parent_type := real_parent_type;
                RETURN NEW;
            END;
            $$;

        CREATE TRIGGER items_check_parent BEFORE INSERT OR UPDATE OF parent_id, type ON public.items FOR EACH ROW EXECUTE FUNCTION public.items_check_parent();

        UPDATE public.notifications
           SET link_url = regexp_replace(link_url, '^/tasks/', '/epics/')
         WHERE link_url LIKE '/tasks/%';
        UPDATE public.notifications
           SET link_url = regexp_replace(link_url, '^/sub-tasks/', '/issues/stories/')
         WHERE link_url LIKE '/sub-tasks/%';
    `);
}
