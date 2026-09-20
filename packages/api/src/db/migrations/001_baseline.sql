--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: atlas_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atlas_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$;


--
-- Name: items_check_parent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.items_check_parent() RETURNS trigger
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




--
-- Name: agent_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_checklists (
    id bigint NOT NULL,
    agent_id text NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    required boolean DEFAULT true NOT NULL
);


--
-- Name: agent_checklists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_checklists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_checklists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_checklists_id_seq OWNED BY public.agent_checklists.id;


--
-- Name: agent_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_memory (
    agent_id text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    source text DEFAULT 'ai-generated'::text NOT NULL,
    last_run_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    runs_since_regen integer DEFAULT 0 NOT NULL,
    CONSTRAINT agent_memory_source_check CHECK ((source = ANY (ARRAY['ai-generated'::text, 'manual-edit'::text])))
);


--
-- Name: agent_prompt_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_prompt_versions (
    id bigint NOT NULL,
    agent_id text NOT NULL,
    version integer NOT NULL,
    body_md text NOT NULL,
    edited_by text DEFAULT 'Owner'::text NOT NULL,
    reverted_from integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_prompt_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_prompt_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_prompt_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_prompt_versions_id_seq OWNED BY public.agent_prompt_versions.id;


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id text NOT NULL,
    agent_id text NOT NULL,
    item_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    prompt_snapshot text,
    output_text text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id text,
    parent_run_id text,
    input_tokens integer,
    output_tokens integer,
    cache_creation_tokens integer,
    cache_read_tokens integer,
    total_cost_usd double precision,
    credits numeric(12,4),
    outcome_kind character varying(255),
    outcome_summary text,
    outcome_reason text,
    outcome_checklist jsonb,
    setup_output_text text,
    workflow_run_id text,
    node_id text,
    cli text,
    model text,
    effort text,
    prompt_version integer,
    CONSTRAINT agent_runs_outcome_kind_check CHECK (((outcome_kind IS NULL) OR ((outcome_kind)::text = ANY (ARRAY[('done'::character varying)::text, ('rejected'::character varying)::text, ('asked_question'::character varying)::text])))),
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'completed'::text, 'error'::text, 'cancelled'::text, 'setup_failed'::text])))
);


--
-- Name: agent_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_templates (
    id text NOT NULL,
    filename text NOT NULL,
    body_md text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    cli text NOT NULL,
    model text NOT NULL,
    framework text DEFAULT ''::text NOT NULL,
    prompt_md text DEFAULT ''::text NOT NULL,
    prompt_version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    accent_color text DEFAULT '#007AC9'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    glyph text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    designation text DEFAULT ''::text NOT NULL,
    memory_cadence integer DEFAULT 1 NOT NULL,
    kind_slug text DEFAULT 'custom'::text NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    role_id text,
    marketplace_source_id text,
    marketplace_pulled_version integer,
    effort character varying(255) DEFAULT 'medium'::character varying NOT NULL,
    CONSTRAINT agents_category_check CHECK ((category = ANY (ARRAY['software-dev'::text, 'marketing'::text, 'content'::text, 'design'::text]))),
    CONSTRAINT agents_cli_check CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text]))),
    CONSTRAINT agents_effort_check CHECK (((effort)::text = ANY (ARRAY[('none'::character varying)::text, ('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text, ('xhigh'::character varying)::text, ('max'::character varying)::text]))),
    CONSTRAINT agents_memory_cadence_check CHECK (((memory_cadence >= 1) AND (memory_cadence <= 100))),
    CONSTRAINT agents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: cli_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cli_models (
    id text NOT NULL,
    cli text NOT NULL,
    model_name text NOT NULL,
    note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cli_models_cli_check CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text])))
);


--
-- Name: cli_session_subagents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cli_session_subagents (
    id text NOT NULL,
    cli_session_id text NOT NULL,
    source text NOT NULL,
    subagent_key text NOT NULL,
    agent_type text,
    description text,
    spawn_depth integer,
    input_tokens integer,
    output_tokens integer,
    cache_creation_tokens integer,
    cache_read_tokens integer,
    cost_usd double precision,
    is_estimate boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cli_session_subagents_source_check CHECK ((source = ANY (ARRAY['claude_jsonl'::text, 'copilot_list'::text])))
);


--
-- Name: cli_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cli_sessions (
    id text NOT NULL,
    project_id text,
    title text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    worktree_path text,
    worktree_branch text,
    claude_session_id text,
    model text NOT NULL,
    initial_prompt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    finalize_pr_url text,
    item_id text,
    cli text DEFAULT 'claude'::text NOT NULL,
    transcript_jsonl text,
    transcript_ingested_at timestamp with time zone,
    total_cost_usd double precision,
    input_tokens integer,
    output_tokens integer,
    cache_creation_tokens integer,
    cache_read_tokens integer,
    credential_id text,
    repo_id text,
    CONSTRAINT cli_sessions_cli_check CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text]))),
    CONSTRAINT cli_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text, 'errored'::text])))
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id bigint NOT NULL,
    author text NOT NULL,
    agent_id text,
    item_id text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT comments_author_check CHECK ((author = ANY (ARRAY['owner'::text, 'agent'::text])))
);


--
-- Name: comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;


--
-- Name: commit_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commit_verifications (
    id bigint NOT NULL,
    run_id text NOT NULL,
    item_id text,
    agent_id text NOT NULL,
    result text NOT NULL,
    commit_count integer DEFAULT 0 NOT NULL,
    problems jsonb DEFAULT '[]'::jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commit_verifications_result_check CHECK ((result = ANY (ARRAY['compliant'::text, 'partial'::text, 'silent'::text, 'clean'::text])))
);


--
-- Name: commit_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commit_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commit_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commit_verifications_id_seq OWNED BY public.commit_verifications.id;


--
-- Name: credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials (
    id text NOT NULL,
    label text NOT NULL,
    host text DEFAULT 'github'::text NOT NULL,
    kind text DEFAULT 'pat'::text NOT NULL,
    username text DEFAULT 'x-access-token'::text NOT NULL,
    token_encrypted text,
    token_fingerprint text,
    scope text DEFAULT ''::text NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    app_id bigint,
    app_private_key_encrypted text,
    app_installation_owner text,
    app_installation_id bigint,
    app_slug text,
    human_name text,
    human_email text,
    human_gh_login text,
    CONSTRAINT credentials_host_check CHECK ((host = 'github'::text)),
    CONSTRAINT credentials_kind_check CHECK ((kind = ANY (ARRAY['pat'::text, 'github_app'::text]))),
    CONSTRAINT credentials_kind_fields_check CHECK ((((kind = 'pat'::text) AND (token_encrypted IS NOT NULL) AND (token_fingerprint IS NOT NULL)) OR ((kind = 'github_app'::text) AND (app_id IS NOT NULL) AND (app_private_key_encrypted IS NOT NULL) AND (app_installation_owner IS NOT NULL))))
);


--
-- Name: environment_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_secrets (
    id text NOT NULL,
    key text NOT NULL,
    value_encrypted text NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: guardrail_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardrail_rules (
    id text NOT NULL,
    category text NOT NULL,
    rule_text text NOT NULL,
    detail text,
    severity text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardrail_rules_category_check CHECK ((category = ANY (ARRAY['file_system'::text, 'secrets_credentials'::text, 'git_branches'::text, 'side_effects_network'::text, 'escalation_scope'::text]))),
    CONSTRAINT guardrail_rules_severity_check CHECK ((severity = ANY (ARRAY['block'::text, 'ask_owner'::text, 'warn'::text])))
);


--
-- Name: guardrail_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardrail_scripts (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    body_sh text NOT NULL,
    body_ps1 text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: issue_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_events (
    id bigint NOT NULL,
    item_id text NOT NULL,
    event_type text NOT NULL,
    actor_agent_id text,
    field text,
    from_value text,
    to_value text,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'status_changed'::text, 'assigned'::text, 'field_updated'::text, 'unblocked'::text, 'comment_added'::text, 'link_created'::text, 'link_deleted'::text, 'rounds_reset'::text, 'dispatch_blocked'::text, 'deleted'::text, 'history_pruned'::text])))
);


--
-- Name: issue_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.issue_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: issue_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.issue_events_id_seq OWNED BY public.issue_events.id;


--
-- Name: item_external_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_external_links (
    id bigint NOT NULL,
    item_id text NOT NULL,
    link_kind text NOT NULL,
    url text NOT NULL,
    title text,
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_run_id text,
    pr_state text,
    pr_state_checked_at timestamp with time zone,
    CONSTRAINT item_external_links_link_kind_check CHECK ((link_kind = ANY (ARRAY['pull_request'::text, 'jira_issue'::text]))),
    CONSTRAINT item_external_links_pr_state_check CHECK ((pr_state = ANY (ARRAY['open'::text, 'merged'::text, 'closed'::text])))
);


--
-- Name: item_external_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_external_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_external_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_external_links_id_seq OWNED BY public.item_external_links.id;


--
-- Name: item_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_links (
    id bigint NOT NULL,
    from_id text NOT NULL,
    to_id text NOT NULL,
    relation_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_links_check CHECK ((from_id <> to_id)),
    CONSTRAINT item_links_relation_type_check CHECK ((relation_type = ANY (ARRAY['relates_to'::text, 'depends_on'::text, 'tested_by'::text])))
);


--
-- Name: item_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_links_id_seq OWNED BY public.item_links.id;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id text NOT NULL,
    project_id text NOT NULL,
    type text NOT NULL,
    parent_id text,
    parent_type text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    assignee_agent_id text,
    reporter_agent_id text,
    priority text,
    spec_md text,
    pr_url text,
    points integer,
    acceptance_criteria text,
    started_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char"))) STORED,
    worktree_branch text,
    worktree_path text,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    workflow_id text,
    sort_order integer,
    repo_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT items_parent_type_check CHECK (((parent_type IS NULL) OR (parent_type = 'task'::text))),
    CONSTRAINT items_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))),
    CONSTRAINT items_type_check CHECK ((type = ANY (ARRAY['task'::text, 'sub_task'::text])))
);


--
-- Name: jira_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jira_config (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    site_url text,
    email text,
    api_token_encrypted text,
    poll_interval_minutes integer DEFAULT 60 NOT NULL,
    extra_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_sync_at timestamp with time zone,
    last_sync_ok boolean,
    last_sync_message text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT jira_config_id_check CHECK ((id = 1)),
    CONSTRAINT jira_config_poll_interval_minutes_check CHECK ((poll_interval_minutes >= 5))
);


--
-- Name: jira_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jira_issues (
    jira_key text NOT NULL,
    item_id text,
    jira_id text NOT NULL,
    url text NOT NULL,
    raw jsonb NOT NULL,
    jira_updated_at timestamp with time zone,
    seen_comment_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    posted_comment_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    imported_comment_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    pushed_comment_id bigint DEFAULT 0 NOT NULL,
    pushed_status text,
    done_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_agent_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_agent_checklists (
    id bigint NOT NULL,
    marketplace_agent_id text NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    required boolean DEFAULT true NOT NULL
);


--
-- Name: marketplace_agent_checklists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketplace_agent_checklists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketplace_agent_checklists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketplace_agent_checklists_id_seq OWNED BY public.marketplace_agent_checklists.id;


--
-- Name: marketplace_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_agents (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    cli text NOT NULL,
    model text NOT NULL,
    framework text DEFAULT ''::text NOT NULL,
    prompt_md text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    designation text DEFAULT ''::text NOT NULL,
    accent_color text DEFAULT '#007AC9'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    glyph text DEFAULT ''::text NOT NULL,
    role_id text,
    status text DEFAULT 'active'::text NOT NULL,
    kind_slug text DEFAULT 'custom'::text NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    memory_cadence integer DEFAULT 1 NOT NULL,
    memory_template_md text DEFAULT ''::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    content_hash text DEFAULT ''::text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    effort character varying(255) DEFAULT 'medium'::character varying NOT NULL,
    CONSTRAINT marketplace_agents_category_check CHECK ((category = ANY (ARRAY['software-dev'::text, 'marketing'::text, 'content'::text, 'design'::text]))),
    CONSTRAINT marketplace_agents_cli_check CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text]))),
    CONSTRAINT marketplace_agents_effort_check CHECK (((effort)::text = ANY (ARRAY[('none'::character varying)::text, ('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text, ('xhigh'::character varying)::text, ('max'::character varying)::text]))),
    CONSTRAINT marketplace_agents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: memory_regenerations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_regenerations (
    id bigint NOT NULL,
    agent_id text NOT NULL,
    run_id text,
    trigger text NOT NULL,
    prev_version integer NOT NULL,
    new_version integer NOT NULL,
    prev_body_hash text NOT NULL,
    new_body_hash text NOT NULL,
    chars_added integer NOT NULL,
    chars_removed integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    boundary_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT memory_regenerations_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'cadence'::text, 'high_signal'::text, 'mcp_update'::text])))
);


--
-- Name: memory_regenerations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_regenerations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_regenerations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_regenerations_id_seq OWNED BY public.memory_regenerations.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    event_type text NOT NULL,
    message text NOT NULL,
    item_id text,
    sent_external integer DEFAULT 0 NOT NULL,
    kind text DEFAULT 'update'::text NOT NULL,
    agent_id text,
    external_status text DEFAULT 'none'::text NOT NULL,
    failure_reason text,
    read_at timestamp with time zone,
    project_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    push_status text DEFAULT 'none'::text NOT NULL,
    push_failure_reason text,
    link_url text,
    CONSTRAINT notifications_external_status_check CHECK ((external_status = ANY (ARRAY['none'::text, 'pending'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['needs_you'::text, 'update'::text, 'system'::text]))),
    CONSTRAINT notifications_push_status_check CHECK ((push_status = ANY (ARRAY['none'::text, 'pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: project_env_vars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_env_vars (
    id text NOT NULL,
    project_id text NOT NULL,
    key text NOT NULL,
    value_encrypted text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_guardrail_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_guardrail_scripts (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    body_sh text NOT NULL,
    body_ps1 text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: project_guardrails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_guardrails (
    id text NOT NULL,
    project_id text NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    icon text DEFAULT 'shield'::text NOT NULL,
    enabled integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_guardrails_enabled_check CHECK ((enabled = ANY (ARRAY[0, 1])))
);


--
-- Name: project_issue_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_issue_counters (
    project_id text NOT NULL,
    last_seq integer DEFAULT 0 NOT NULL
);


--
-- Name: project_repos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_repos (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    git_url text NOT NULL,
    git_path text NOT NULL,
    credential_id text,
    default_branch text DEFAULT 'main'::text NOT NULL,
    clone_status text DEFAULT 'ready'::text NOT NULL,
    setup_sh_body text DEFAULT ''::text NOT NULL,
    setup_ps1_body text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_repos_clone_status_check CHECK ((clone_status = ANY (ARRAY['pending'::text, 'cloning'::text, 'ready'::text, 'error'::text]))),
    CONSTRAINT project_repos_name_check CHECK ((name ~ '^[a-z0-9][a-z0-9-]{0,39}$'::text))
);


--
-- Name: project_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_schedules (
    project_id text NOT NULL,
    enabled integer DEFAULT 0 NOT NULL,
    preset text DEFAULT 'daily'::text NOT NULL,
    cron_expression text NOT NULL,
    time_of_day text DEFAULT '06:00'::text NOT NULL,
    weekday integer,
    skip_if_dirty integer DEFAULT 1 NOT NULL,
    pause_while_agents_active integer DEFAULT 0 NOT NULL,
    conflict_policy text DEFAULT 'skip'::text NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status text,
    last_run_detail text,
    next_run_at timestamp with time zone,
    auth_failure_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    repo_id text NOT NULL,
    CONSTRAINT project_schedules_conflict_policy_check CHECK ((conflict_policy = ANY (ARRAY['skip'::text, 'stash'::text, 'abort'::text]))),
    CONSTRAINT project_schedules_last_run_status_check CHECK (((last_run_status IS NULL) OR (last_run_status = ANY (ARRAY['success'::text, 'skipped'::text, 'failure'::text, 'conflict'::text])))),
    CONSTRAINT project_schedules_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6))))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id text NOT NULL,
    name text NOT NULL,
    issue_key_prefix text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    guardrails_md text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_issue_key_prefix_check CHECK ((issue_key_prefix ~ '^[A-Z]{3}$'::text))
);


--
-- Name: published_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.published_workflows (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    source_workflow_id text,
    bundle bytea NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id bigint NOT NULL,
    label text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    schedule_kind text NOT NULL,
    schedule_value text NOT NULL,
    channel text DEFAULT 'notification'::text NOT NULL,
    next_fire_at timestamp with time zone NOT NULL,
    last_fired_at timestamp with time zone,
    created_by_agent_id text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reminders_channel_check CHECK ((channel = ANY (ARRAY['external'::text, 'notification'::text, 'both'::text]))),
    CONSTRAINT reminders_kind_check CHECK ((schedule_kind = ANY (ARRAY['once'::text, 'daily'::text, 'weekly'::text, 'cron'::text]))),
    CONSTRAINT reminders_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'completed'::text])))
);


--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    default_prompt_md text DEFAULT ''::text NOT NULL,
    default_status text DEFAULT 'inactive'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_default_status_check CHECK ((default_status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: scratch_pad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scratch_pad (
    id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id smallint NOT NULL,
    owner_name text DEFAULT 'Owner'::text NOT NULL,
    workspace_path text DEFAULT ''::text NOT NULL,
    constitution_md text DEFAULT ''::text NOT NULL,
    external_notification_token text,
    onboarding_complete integer DEFAULT 0 NOT NULL,
    external_notification_chat_id text,
    accent_color text DEFAULT '#2E2E2E'::text NOT NULL,
    external_notification_event_toggles text DEFAULT '{}'::text NOT NULL,
    quiet_hours_from text,
    quiet_hours_to text,
    quiet_hours_timezone text,
    external_notification_last_test_ok integer,
    external_notification_endpoint_label text,
    guardrails_published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quiet_hours_enabled integer DEFAULT 0 NOT NULL,
    vapid_public_key text,
    vapid_private_key text,
    external_notification_provider text DEFAULT 'telegram'::text NOT NULL,
    external_notification_webhook_url text,
    terminal_idle_notify_seconds integer DEFAULT 300 NOT NULL,
    CONSTRAINT settings_external_notification_provider_check CHECK ((external_notification_provider = ANY (ARRAY['telegram'::text, 'teams'::text]))),
    CONSTRAINT settings_id_check CHECK ((id = 1))
);


--
-- Name: tool_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_catalog (
    tool_name text NOT NULL,
    group_name text NOT NULL,
    description text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id text NOT NULL,
    workflow_id text NOT NULL,
    item_id text,
    project_id text,
    status text DEFAULT 'running'::text NOT NULL,
    graph_snapshot jsonb NOT NULL,
    current_node_id text,
    parked_node_id text,
    park_reason text,
    loop_count integer DEFAULT 0 NOT NULL,
    branch text,
    worktree_path text,
    setup_done boolean DEFAULT false NOT NULL,
    pr_url text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    parent_workflow_run_id text,
    parent_node_id text,
    gate_rounds integer DEFAULT 0 NOT NULL,
    CONSTRAINT workflow_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'waiting_for_owner'::text, 'completed'::text, 'cancelled'::text, 'error'::text])))
);


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflows (
    id text NOT NULL,
    project_id text,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    graph jsonb DEFAULT '{"edges": [], "nodes": []}'::jsonb NOT NULL,
    input_kind text DEFAULT 'item'::text NOT NULL,
    trigger text DEFAULT 'manual'::text NOT NULL,
    use_worktree boolean DEFAULT true NOT NULL,
    push_code boolean DEFAULT true NOT NULL,
    raises_pr boolean DEFAULT true NOT NULL,
    max_loops integer DEFAULT 3 NOT NULL,
    schedule_preset text,
    schedule_time_of_day text,
    schedule_weekday integer,
    cron_expr text,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    max_parallel_runs integer DEFAULT 1 NOT NULL,
    push_to_default boolean DEFAULT false NOT NULL,
    CONSTRAINT workflows_input_kind_check CHECK ((input_kind = ANY (ARRAY['item'::text, 'none'::text, 'sub_task'::text]))),
    CONSTRAINT workflows_max_loops_check CHECK (((max_loops >= 1) AND (max_loops <= 20))),
    CONSTRAINT workflows_max_parallel_runs_check CHECK (((max_parallel_runs >= 1) AND (max_parallel_runs <= 10))),
    CONSTRAINT workflows_project_required_check CHECK (((project_id IS NOT NULL) OR ((input_kind = 'none'::text) AND (NOT use_worktree)))),
    CONSTRAINT workflows_schedule_preset_check CHECK ((schedule_preset = ANY (ARRAY['hourly'::text, 'every_4h'::text, 'daily'::text, 'weekly'::text, 'custom'::text]))),
    CONSTRAINT workflows_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT workflows_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'schedule'::text, 'item_ready'::text])))
);


--
-- Name: agent_checklists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checklists ALTER COLUMN id SET DEFAULT nextval('public.agent_checklists_id_seq'::regclass);


--
-- Name: agent_prompt_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_versions ALTER COLUMN id SET DEFAULT nextval('public.agent_prompt_versions_id_seq'::regclass);


--
-- Name: comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);


--
-- Name: commit_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commit_verifications ALTER COLUMN id SET DEFAULT nextval('public.commit_verifications_id_seq'::regclass);


--
-- Name: issue_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_events ALTER COLUMN id SET DEFAULT nextval('public.issue_events_id_seq'::regclass);


--
-- Name: item_external_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_external_links ALTER COLUMN id SET DEFAULT nextval('public.item_external_links_id_seq'::regclass);


--
-- Name: item_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_links ALTER COLUMN id SET DEFAULT nextval('public.item_links_id_seq'::regclass);


--
-- Name: marketplace_agent_checklists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_agent_checklists ALTER COLUMN id SET DEFAULT nextval('public.marketplace_agent_checklists_id_seq'::regclass);


--
-- Name: memory_regenerations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_regenerations ALTER COLUMN id SET DEFAULT nextval('public.memory_regenerations_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: agent_checklists agent_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checklists
    ADD CONSTRAINT agent_checklists_pkey PRIMARY KEY (id);


--
-- Name: agent_memory agent_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (agent_id);


--
-- Name: agent_prompt_versions agent_prompt_versions_agent_id_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_versions
    ADD CONSTRAINT agent_prompt_versions_agent_id_version_unique UNIQUE (agent_id, version);


--
-- Name: agent_prompt_versions agent_prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_versions
    ADD CONSTRAINT agent_prompt_versions_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: agent_templates agent_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_templates
    ADD CONSTRAINT agent_templates_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: cli_models cli_models_cli_model_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_models
    ADD CONSTRAINT cli_models_cli_model_name_key UNIQUE (cli, model_name);


--
-- Name: cli_models cli_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_models
    ADD CONSTRAINT cli_models_pkey PRIMARY KEY (id);


--
-- Name: cli_session_subagents cli_session_subagents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_session_subagents
    ADD CONSTRAINT cli_session_subagents_pkey PRIMARY KEY (id);


--
-- Name: cli_session_subagents cli_session_subagents_session_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_session_subagents
    ADD CONSTRAINT cli_session_subagents_session_key_unique UNIQUE (cli_session_id, subagent_key);


--
-- Name: cli_sessions cli_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_sessions
    ADD CONSTRAINT cli_sessions_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: commit_verifications commit_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commit_verifications
    ADD CONSTRAINT commit_verifications_pkey PRIMARY KEY (id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);


--
-- Name: environment_secrets environment_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_secrets
    ADD CONSTRAINT environment_secrets_pkey PRIMARY KEY (id);


--
-- Name: guardrail_rules guardrail_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardrail_rules
    ADD CONSTRAINT guardrail_rules_pkey PRIMARY KEY (id);


--
-- Name: guardrail_scripts guardrail_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardrail_scripts
    ADD CONSTRAINT guardrail_scripts_pkey PRIMARY KEY (id);


--
-- Name: issue_events issue_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_events
    ADD CONSTRAINT issue_events_pkey PRIMARY KEY (id);


--
-- Name: item_external_links item_external_links_item_url_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_external_links
    ADD CONSTRAINT item_external_links_item_url_unique UNIQUE (item_id, url);


--
-- Name: item_external_links item_external_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_external_links
    ADD CONSTRAINT item_external_links_pkey PRIMARY KEY (id);


--
-- Name: item_links item_links_from_id_to_id_relation_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_links
    ADD CONSTRAINT item_links_from_id_to_id_relation_type_key UNIQUE (from_id, to_id, relation_type);


--
-- Name: item_links item_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_links
    ADD CONSTRAINT item_links_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: jira_config jira_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_config
    ADD CONSTRAINT jira_config_pkey PRIMARY KEY (id);


--
-- Name: jira_issues jira_issues_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_issues
    ADD CONSTRAINT jira_issues_item_id_key UNIQUE (item_id);


--
-- Name: jira_issues jira_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_issues
    ADD CONSTRAINT jira_issues_pkey PRIMARY KEY (jira_key);


--
-- Name: marketplace_agent_checklists marketplace_agent_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_agent_checklists
    ADD CONSTRAINT marketplace_agent_checklists_pkey PRIMARY KEY (id);


--
-- Name: marketplace_agents marketplace_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_agents
    ADD CONSTRAINT marketplace_agents_pkey PRIMARY KEY (id);


--
-- Name: memory_regenerations memory_regenerations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_regenerations
    ADD CONSTRAINT memory_regenerations_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: project_env_vars project_env_vars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_env_vars
    ADD CONSTRAINT project_env_vars_pkey PRIMARY KEY (id);


--
-- Name: project_env_vars project_env_vars_project_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_env_vars
    ADD CONSTRAINT project_env_vars_project_id_key_key UNIQUE (project_id, key);


--
-- Name: project_guardrail_scripts project_guardrail_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_guardrail_scripts
    ADD CONSTRAINT project_guardrail_scripts_pkey PRIMARY KEY (id);


--
-- Name: project_guardrails project_guardrails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_guardrails
    ADD CONSTRAINT project_guardrails_pkey PRIMARY KEY (id);


--
-- Name: project_issue_counters project_issue_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_issue_counters
    ADD CONSTRAINT project_issue_counters_pkey PRIMARY KEY (project_id);


--
-- Name: project_repos project_repos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_pkey PRIMARY KEY (id);


--
-- Name: project_repos project_repos_project_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_project_name_unique UNIQUE (project_id, name);


--
-- Name: project_schedules project_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (repo_id);


--
-- Name: projects projects_issue_key_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_issue_key_prefix_key UNIQUE (issue_key_prefix);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: published_workflows published_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_workflows
    ADD CONSTRAINT published_workflows_pkey PRIMARY KEY (id);


--
-- Name: published_workflows published_workflows_source_workflow_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_workflows
    ADD CONSTRAINT published_workflows_source_workflow_id_key UNIQUE (source_workflow_id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (endpoint);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: scratch_pad scratch_pad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scratch_pad
    ADD CONSTRAINT scratch_pad_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: tool_catalog tool_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_catalog
    ADD CONSTRAINT tool_catalog_pkey PRIMARY KEY (tool_name);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: agent_runs_one_live_per_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_runs_one_live_per_item ON public.agent_runs USING btree (item_id) WHERE ((status = ANY (ARRAY['queued'::text, 'in_progress'::text])) AND (item_id IS NOT NULL));


--
-- Name: agent_runs_workflow_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_workflow_run_id_idx ON public.agent_runs USING btree (workflow_run_id) WHERE (workflow_run_id IS NOT NULL);


--
-- Name: cli_sessions_one_active_per_repo_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cli_sessions_one_active_per_repo_branch ON public.cli_sessions USING btree (repo_id, worktree_branch) WHERE ((status = ANY (ARRAY['active'::text, 'paused'::text])) AND (worktree_branch IS NOT NULL));


--
-- Name: environment_secrets_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_secrets_key_unique ON public.environment_secrets USING btree (key);


--
-- Name: idx_agent_checklists_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_checklists_agent ON public.agent_checklists USING btree (agent_id, sort_order);


--
-- Name: idx_agent_prompt_versions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_prompt_versions_agent ON public.agent_prompt_versions USING btree (agent_id, version DESC);


--
-- Name: idx_agent_runs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_agent ON public.agent_runs USING btree (agent_id);


--
-- Name: idx_agent_runs_agent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_agent_status ON public.agent_runs USING btree (agent_id, status) WHERE (status = ANY (ARRAY['queued'::text, 'in_progress'::text]));


--
-- Name: idx_agent_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_created_at ON public.agent_runs USING btree (created_at DESC);


--
-- Name: idx_agent_runs_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_item ON public.agent_runs USING btree (item_id, created_at DESC);


--
-- Name: idx_agent_runs_parent_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_parent_run_id ON public.agent_runs USING btree (parent_run_id) WHERE (parent_run_id IS NOT NULL);


--
-- Name: idx_agent_runs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_project_id ON public.agent_runs USING btree (project_id) WHERE (project_id IS NOT NULL);


--
-- Name: idx_agent_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_status ON public.agent_runs USING btree (status);


--
-- Name: idx_agent_runs_status_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_status_completed_at ON public.agent_runs USING btree (status, completed_at DESC) WHERE ((status = 'completed'::text) AND (completed_at IS NOT NULL));


--
-- Name: idx_agent_runs_status_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_status_started_at ON public.agent_runs USING btree (status, started_at) WHERE (status = 'in_progress'::text);


--
-- Name: idx_agent_runs_total_cost; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_total_cost ON public.agent_runs USING btree (total_cost_usd DESC) WHERE ((status = 'completed'::text) AND (total_cost_usd IS NOT NULL));


--
-- Name: idx_agents_kind_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_kind_slug ON public.agents USING btree (kind_slug);


--
-- Name: idx_agents_marketplace_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_marketplace_source_id ON public.agents USING btree (marketplace_source_id);


--
-- Name: idx_agents_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_role_id ON public.agents USING btree (role_id);


--
-- Name: idx_agents_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_sort_order ON public.agents USING btree (sort_order);


--
-- Name: idx_agents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_status ON public.agents USING btree (status);


--
-- Name: idx_cli_models_cli; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cli_models_cli ON public.cli_models USING btree (cli, sort_order);


--
-- Name: idx_cli_session_subagents_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cli_session_subagents_session ON public.cli_session_subagents USING btree (cli_session_id);


--
-- Name: idx_cli_sessions_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cli_sessions_item_id ON public.cli_sessions USING btree (item_id) WHERE (item_id IS NOT NULL);


--
-- Name: idx_cli_sessions_last_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cli_sessions_last_active ON public.cli_sessions USING btree (last_active_at DESC);


--
-- Name: idx_cli_sessions_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cli_sessions_project_status ON public.cli_sessions USING btree (project_id, status);


--
-- Name: idx_comments_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_agent ON public.comments USING btree (agent_id);


--
-- Name: idx_comments_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_item ON public.comments USING btree (item_id, created_at);


--
-- Name: idx_commit_verifications_agent_checked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commit_verifications_agent_checked ON public.commit_verifications USING btree (agent_id, checked_at DESC);


--
-- Name: idx_credentials_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credentials_host ON public.credentials USING btree (host);


--
-- Name: idx_guardrail_rules_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardrail_rules_category ON public.guardrail_rules USING btree (category, sort_order);


--
-- Name: idx_issue_events_actor_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_events_actor_agent ON public.issue_events USING btree (actor_agent_id) WHERE (actor_agent_id IS NOT NULL);


--
-- Name: idx_issue_events_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_events_item ON public.issue_events USING btree (item_id, created_at);


--
-- Name: idx_issue_events_item_agent_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_events_item_agent_event ON public.issue_events USING btree (item_id, actor_agent_id, event_type);


--
-- Name: idx_item_external_links_created_by_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_external_links_created_by_run_id ON public.item_external_links USING btree (created_by_run_id) WHERE (created_by_run_id IS NOT NULL);


--
-- Name: idx_item_external_links_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_external_links_item_id ON public.item_external_links USING btree (item_id);


--
-- Name: idx_item_links_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_links_from ON public.item_links USING btree (from_id, relation_type);


--
-- Name: idx_item_links_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_links_to ON public.item_links USING btree (to_id, relation_type);


--
-- Name: idx_items_assignee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_assignee_status ON public.items USING btree (assignee_agent_id, status) WHERE (assignee_agent_id IS NOT NULL);


--
-- Name: idx_items_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_parent ON public.items USING btree (parent_id);


--
-- Name: idx_items_parent_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_parent_updated_at ON public.items USING btree (parent_id, updated_at DESC) WHERE (parent_id IS NOT NULL);


--
-- Name: idx_items_project_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_project_type ON public.items USING btree (project_id, type);


--
-- Name: idx_items_project_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_project_type_status ON public.items USING btree (project_id, type, status);


--
-- Name: idx_items_project_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_project_updated_at ON public.items USING btree (project_id, updated_at DESC);


--
-- Name: idx_items_reporter_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_reporter_agent ON public.items USING btree (reporter_agent_id) WHERE (reporter_agent_id IS NOT NULL);


--
-- Name: idx_items_search_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_search_tsv ON public.items USING gin (search_tsv);


--
-- Name: idx_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_status ON public.items USING btree (status);


--
-- Name: idx_items_type_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_type_created_at ON public.items USING btree (type, created_at DESC);


--
-- Name: idx_items_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_type_status ON public.items USING btree (type, status);


--
-- Name: idx_items_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_updated_at ON public.items USING btree (updated_at DESC);


--
-- Name: idx_marketplace_agent_checklists_marketplace_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_agent_checklists_marketplace_agent_id ON public.marketplace_agent_checklists USING btree (marketplace_agent_id);


--
-- Name: idx_memory_regenerations_agent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_regenerations_agent_created ON public.memory_regenerations USING btree (agent_id, created_at DESC);


--
-- Name: idx_notifications_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_agent ON public.notifications USING btree (agent_id) WHERE (agent_id IS NOT NULL);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_external_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_external_status ON public.notifications USING btree (external_status, created_at DESC);


--
-- Name: idx_notifications_external_status_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_external_status_active ON public.notifications USING btree (external_status, created_at DESC) WHERE (external_status <> 'none'::text);


--
-- Name: idx_notifications_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_item ON public.notifications USING btree (item_id, created_at DESC);


--
-- Name: idx_notifications_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_kind ON public.notifications USING btree (kind, created_at DESC);


--
-- Name: idx_notifications_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_project ON public.notifications USING btree (project_id, created_at DESC);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_project_env_vars_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_env_vars_project ON public.project_env_vars USING btree (project_id);


--
-- Name: idx_project_guardrail_scripts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_guardrail_scripts_project_id ON public.project_guardrail_scripts USING btree (project_id);


--
-- Name: idx_project_guardrails_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_guardrails_project ON public.project_guardrails USING btree (project_id, sort_order);


--
-- Name: idx_project_repos_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_repos_project_id ON public.project_repos USING btree (project_id);


--
-- Name: idx_project_schedules_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_schedules_enabled ON public.project_schedules USING btree (enabled);


--
-- Name: idx_projects_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_created_at ON public.projects USING btree (created_at DESC);


--
-- Name: idx_reminders_next_fire_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_next_fire_active ON public.reminders USING btree (next_fire_at) WHERE (status = 'active'::text);


--
-- Name: idx_scratch_pad_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scratch_pad_updated_at ON public.scratch_pad USING btree (updated_at DESC);


--
-- Name: idx_tool_catalog_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_catalog_group ON public.tool_catalog USING btree (group_name, sort_order);


--
-- Name: items_labels_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX items_labels_gin ON public.items USING gin (labels jsonb_path_ops);


--
-- Name: items_workflow_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX items_workflow_status_idx ON public.items USING btree (workflow_id, status) WHERE (workflow_id IS NOT NULL);


--
-- Name: workflow_runs_one_live_per_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_runs_one_live_per_item ON public.workflow_runs USING btree (item_id) WHERE (status = ANY (ARRAY['running'::text, 'waiting_for_owner'::text]));


--
-- Name: workflow_runs_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_runs_parent_idx ON public.workflow_runs USING btree (parent_workflow_run_id) WHERE (parent_workflow_run_id IS NOT NULL);


--
-- Name: workflow_runs_workflow_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_runs_workflow_started_idx ON public.workflow_runs USING btree (workflow_id, started_at DESC);


--
-- Name: agent_memory agent_memory_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_memory_set_updated_at BEFORE UPDATE ON public.agent_memory FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: agents agents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agents_set_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: credentials credentials_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER credentials_set_updated_at BEFORE UPDATE ON public.credentials FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: guardrail_rules guardrail_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guardrail_rules_set_updated_at BEFORE UPDATE ON public.guardrail_rules FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: items items_check_parent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_check_parent BEFORE INSERT OR UPDATE OF parent_id, type ON public.items FOR EACH ROW EXECUTE FUNCTION public.items_check_parent();


--
-- Name: items items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: project_guardrails project_guardrails_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_guardrails_set_updated_at BEFORE UPDATE ON public.project_guardrails FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: project_schedules project_schedules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_schedules_set_updated_at BEFORE UPDATE ON public.project_schedules FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: projects projects_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: settings settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: workflow_runs workflow_runs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON public.workflow_runs FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: workflows workflows_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();


--
-- Name: agent_checklists agent_checklists_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checklists
    ADD CONSTRAINT agent_checklists_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_memory agent_memory_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_memory agent_memory_last_run_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_last_run_fk FOREIGN KEY (last_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;


--
-- Name: agent_prompt_versions agent_prompt_versions_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_versions
    ADD CONSTRAINT agent_prompt_versions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_runs agent_runs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_runs agent_runs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: agent_runs agent_runs_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;


--
-- Name: agent_runs agent_runs_workflow_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_workflow_run_id_fkey FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: agents agents_cli_model_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_cli_model_fk FOREIGN KEY (cli, model) REFERENCES public.cli_models(cli, model_name) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: agents agents_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: cli_session_subagents cli_session_subagents_cli_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_session_subagents
    ADD CONSTRAINT cli_session_subagents_cli_session_id_fkey FOREIGN KEY (cli_session_id) REFERENCES public.cli_sessions(id) ON DELETE CASCADE;


--
-- Name: cli_sessions cli_sessions_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_sessions
    ADD CONSTRAINT cli_sessions_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.credentials(id) ON DELETE SET NULL;


--
-- Name: cli_sessions cli_sessions_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_sessions
    ADD CONSTRAINT cli_sessions_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: cli_sessions cli_sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_sessions
    ADD CONSTRAINT cli_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: cli_sessions cli_sessions_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_sessions
    ADD CONSTRAINT cli_sessions_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.project_repos(id) ON DELETE SET NULL;


--
-- Name: comments comments_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: comments comments_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: issue_events issue_events_actor_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_events
    ADD CONSTRAINT issue_events_actor_agent_id_fkey FOREIGN KEY (actor_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: issue_events issue_events_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_events
    ADD CONSTRAINT issue_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: item_external_links item_external_links_created_by_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_external_links
    ADD CONSTRAINT item_external_links_created_by_run_id_fkey FOREIGN KEY (created_by_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;


--
-- Name: item_external_links item_external_links_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_external_links
    ADD CONSTRAINT item_external_links_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: item_links item_links_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_links
    ADD CONSTRAINT item_links_from_id_fkey FOREIGN KEY (from_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: item_links item_links_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_links
    ADD CONSTRAINT item_links_to_id_fkey FOREIGN KEY (to_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: items items_assignee_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_assignee_agent_id_fkey FOREIGN KEY (assignee_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: items items_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: items items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: items items_reporter_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_reporter_agent_id_fkey FOREIGN KEY (reporter_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: items items_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE SET NULL;


--
-- Name: jira_issues jira_issues_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_issues
    ADD CONSTRAINT jira_issues_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: marketplace_agent_checklists marketplace_agent_checklists_marketplace_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_agent_checklists
    ADD CONSTRAINT marketplace_agent_checklists_marketplace_agent_id_fkey FOREIGN KEY (marketplace_agent_id) REFERENCES public.marketplace_agents(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: project_env_vars project_env_vars_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_env_vars
    ADD CONSTRAINT project_env_vars_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_guardrail_scripts project_guardrail_scripts_project_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_guardrail_scripts
    ADD CONSTRAINT project_guardrail_scripts_project_id_foreign FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_guardrails project_guardrails_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_guardrails
    ADD CONSTRAINT project_guardrails_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_issue_counters project_issue_counters_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_issue_counters
    ADD CONSTRAINT project_issue_counters_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_repos project_repos_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.credentials(id) ON DELETE SET NULL;


--
-- Name: project_repos project_repos_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_schedules project_schedules_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_schedules project_schedules_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.project_repos(id) ON DELETE CASCADE;


--
-- Name: published_workflows published_workflows_source_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_workflows
    ADD CONSTRAINT published_workflows_source_workflow_id_fkey FOREIGN KEY (source_workflow_id) REFERENCES public.workflows(id) ON DELETE SET NULL;


--
-- Name: workflow_runs workflow_runs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: workflow_runs workflow_runs_parent_workflow_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_parent_workflow_run_id_fkey FOREIGN KEY (parent_workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_runs workflow_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Reference data. pg_dump --schema-only does not emit these; they are
-- dumped separately with --column-inserts and appended here. A baseline
-- without them produces an install with no CLI models, roles or
-- guard-rail rules, and no settings singleton to onboard into.
--

INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-claude-opus-4-7', 'claude', 'claude-opus-4-7', 'Strongest reasoning. Best for plans, designs, complex refactors.', 1, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-claude-opus-4-7-1m', 'claude', 'claude-opus-4-7[1m]', 'Opus 4.7 with 1M context. Pick for very large repos or long histories.', 2, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-claude-opus-4-6', 'claude', 'claude-opus-4-6', 'Previous-gen Opus. Capable but superseded by 4-7.', 3, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-claude-sonnet-4-6', 'claude', 'claude-sonnet-4-6', 'Fast and accurate at code. Default for the Coder agent.', 4, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-claude-haiku', 'claude', 'haiku', 'Cheapest and fastest. Short, well-scoped tasks only.', 5, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-sonnet-4-6', 'copilot', 'claude-sonnet-4.6', 'Balanced. Reliable for everyday code edits.', 1, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-sonnet-4-5', 'copilot', 'claude-sonnet-4.5', 'Older Sonnet. Solid fallback when 4.6 is unavailable.', 2, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-haiku-4-5', 'copilot', 'claude-haiku-4.5', 'Lightweight Claude. Trivial tasks at low cost.', 3, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-opus-4-6', 'copilot', 'claude-opus-4.6', 'High capability. Use when reasoning depth matters.', 4, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-opus-4-5', 'copilot', 'claude-opus-4.5', 'Older Opus. Capable but not first pick.', 5, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-gpt-5-4', 'copilot', 'gpt-5.4', 'Strong general reasoning. Good for non-code tasks too.', 6, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-gpt-5-3-codex', 'copilot', 'gpt-5.3-codex', 'Code-tuned. Raw edits over planning.', 7, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-gpt-5-4-mini', 'copilot', 'gpt-5.4-mini', 'Cheap GPT-5. Tight budgets and simple tasks.', 8, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-gpt-4-1', 'copilot', 'gpt-4.1', 'Older GPT. Stable fallback.', 9, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-opus-4-7', 'copilot', 'claude-opus-4.7', 'Latest-gen Opus. Reach for it when reasoning depth matters.', 10, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-copilot-gpt-5-2', 'copilot', 'gpt-5.2', 'GPT-5 mid-tier. Balanced cost / capability.', 11, '2026-06-02 16:51:18.805809+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-ollama-qwen3-5', 'ollama', 'qwen3.5', 'Local. Ollama’s default coding pick — set a 64k+ context window for large repos.', 1, '2026-09-20 07:32:01.238202+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-ollama-kimi-k2-7-code', 'ollama', 'kimi-k2.7-code:cloud', 'Cloud. Code-tuned; runs without downloading weights.', 2, '2026-09-20 07:32:01.238202+00');
INSERT INTO public.cli_models (id, cli, model_name, note, sort_order, created_at) VALUES ('seed-ollama-gemma4', 'ollama', 'gemma4:cloud', 'Cloud. General-purpose; good for research and non-code work.', 3, '2026-09-20 07:32:01.238202+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-fs-stay-in-cwd', 'file_system', 'Never touch anything outside the project working directory.', 'Refuse even when prompted. Forbidden surfaces include: paths that escape the working tree (parent traversal, absolute paths); OS files and system locations (C:\Windows\, C:\System32\, /etc/, /usr/, /System/, ~/.ssh/, the system registry, global config); destructive shell commands (rm -rf /, format, del /f /s /q, recursive deletes outside the working tree).', 'block', 1, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-fs-out-of-tree-edit', 'file_system', 'Editing files outside the directory tree of the assigned issue surfaces a warning.', 'Soft signal - the edit may be legitimate (cross-cutting refactor), but it should be visible in review.', 'warn', 5, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-sec-no-exfiltrate', 'secrets_credentials', 'Never send credentials or secret material to external endpoints, including documented APIs.', 'Crucial. Even when an API expects an auth token, the request URL, body, and any telemetry must not include the secret in plain form.', 'block', 2, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-sec-redact-on-output', 'secrets_credentials', 'If a secret pattern is detected in agent output, redact it and pause the run for Owner review.', 'Stop the run, route to Waiting for Info, and surface to the Owner via notification - do not silently continue.', 'ask_owner', 4, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-git-no-force-push', 'git_branches', 'Never force-push (git push --force, --force-with-lease, +ref) to any branch.', 'Force-push silently overwrites history shared with other contributors. Open a new branch instead.', 'block', 1, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-git-no-history-rewrite', 'git_branches', 'Never rewrite history (rebase, --amend, filter-branch, reset --hard) on a branch that has been pushed.', 'Local-only rebases on un-pushed feature branches are fine; rewriting shared history is not.', 'block', 3, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-git-cherrypick-revert', 'git_branches', 'Cherry-picking, reverting commits, or reflog manipulation requires Owner confirmation.', 'These are sharp tools - one wrong pick can resurrect deleted work or hide it.', 'ask_owner', 5, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-net-no-exfiltrate-cwd', 'side_effects_network', 'Never send working-directory contents to external hosts outside the Allowed Tools matrix.', 'Exfiltration risk. Includes uploads to pastebins, cloud storage, public gists, and any documented endpoint not on the allowlist.', 'block', 1, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-net-no-background-process', 'side_effects_network', 'Never start a long-running background process, daemon, or port-bound listener.', 'Agents must complete and exit. No forever, pm2, systemctl start, or port-binding servers from an agent run.', 'block', 2, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-net-outbound-http', 'side_effects_network', 'Outbound HTTP to hosts not on the Allowed Tools matrix requires Owner confirmation per run.', 'Restrict network egress to documented integrations. New hosts pause for approval.', 'ask_owner', 5, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-net-no-test-execution', 'side_effects_network', 'Never execute the project''s test suite. CI gates every merge; local test runs burn tokens without adding signal.', 'Bans every test runner: pnpm test, pnpm test:e2e, vitest, jest, mocha, playwright test, cypress, pytest, go test, cargo test, rspec, phpunit, and any other invocation that runs the project test suite. Verify your work with typecheck + lint only. The merge gate lives in .github/workflows/test.yml.', 'block', 6, '2026-06-03 00:00:00+00', '2026-06-03 00:00:00+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-esc-owner-only', 'escalation_scope', 'Agents escalate ONLY to the Owner. Never reassign or hand off work to another agent.', 'Single point of human control. Prevents cyclic agent-to-agent handoffs.', 'block', 1, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-esc-scope-expansion', 'escalation_scope', 'Expanding the run scope beyond the assigned issue requires Owner confirmation.', 'An agent on Story X must not silently address Story Y. If the change scope grows, pause and ask.', 'ask_owner', 3, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.guardrail_rules (id, category, rule_text, detail, severity, sort_order, created_at, updated_at) VALUES ('seed-esc-spec-discrepancy', 'escalation_scope', 'If a Coder agent finds a Spec discrepancy, it must pause and ask the Owner - never silently rewrite the Spec.', 'Spec ownership belongs to the Spec Writer / Owner, not to Coder.', 'ask_owner', 4, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.roles (id, label, description, default_prompt_md, default_status, sort_order, created_at, updated_at) VALUES ('po', 'Product Owner', 'Decomposes Epics into independently-shippable Stories. Owns the brainstorm-before-scope discipline.', '# PO Writer
You take an Epic and break it into Stories that each deliver one **end-to-end user-shippable capability**. Your output is **rows in the database**, not text in the run log.
## You are agent `agent-po-writer`
Use this id wherever a tool asks for `agent_id`.
## Assumptions about the project
Every project assigned here is **AI-ready** — its repo at `project.git_path` ships with the standard agent-context documents your CLI loads automatically at session start: `CLAUDE.md`, `AGENTS.md`, `GLOSSARY.md`, `ARCHITECTURE.md` (plus any other docs the project keeps for AI consumers). Treat those as **authoritative** for what the project supports today.
If any of those documents are missing, contradict each other, or fail to address the requested capability, raise it as a clarifying question rather than guessing or extrapolating. "The project does not appear to be AI-ready in area X" is a valid question to surface.
## How you work
### Step 1 — Kind guard
Check the item''s `issue_type` first. **You only operate on epics.**
If `issue_type != "epic"`, post a single comment and exit:
```
addCommentToItem({
  issue_type: <the kind>,
  issue_id: <the item id>,
  agent_id: "agent-po-writer",
  body: "PO Writer only operates on epics. This item is a `<kind>` — please reassign to the appropriate agent or escalate to the Owner."
})
```
Do not call `getEpic`. Do not run the brainstorm pass. Do not create children. One-line run output: `Refused: PO Writer is epic-only; this is a <kind>.`
### Step 2 — Read the epic
`getEpic({ id: <epic-id-from-your-prompt> })` loads the full payload — title, description, priority, status.
### Step 3 — Check capability alignment
Cross-read the epic against the project''s auto-loaded context docs. Decide whether the request is:
- **In scope of current capabilities** — uses features the project already supports.
- **An extension** — a new feature that fits the architecture but doesn''t exist yet.
- **A misfit** — fundamentally incompatible with the project''s stated direction.
This judgment shapes the questions you ask in Step 4. Don''t write it up as prose; let it inform your scoping.
### Step 4 — Brainstorming protocol
Before drafting any stories, you ALWAYS run a clarifying-question pass. The substrate is the comment thread on this Epic; `listComments` plus the thread already injected into your prompt give you the conversation history.
1. **Read the comment thread.** Look specifically for any prior comment from yourself starting with `## Brainstorm — open questions`.
2. **Decide which run you are in:**
   - **No prior brainstorm comment from you on this Epic:** this is Run 1. Generate a numbered list of every clarifying question that would change how you''d scope the work. Aim for 3–7 questions. Phrase each as a single, answerable question (no "and"-joined doubles). Examples worth asking: who the user is, the user-visible surface boundaries you can''t infer from the Epic, the rollback story, what''s explicitly out of scope, performance / SLA expectations, dependencies on other Epics, anything where the project''s AI-readiness docs are silent or ambiguous.
   - **A prior brainstorm comment from you exists AND the Owner has replied below it:** re-read your questions and the Owner''s answers. Decide:
     **(a) Proceed to scope.** Either all material questions are answered, OR the Owner has explicitly told you to proceed (e.g. "draft the stories", "go ahead", "ready"). Read intent generously; the Owner''s short-circuit always wins. Skip to **Step 5**.
     **(b) Post a SHORT follow-up.** Material gaps remain, or new questions emerged from the answers. Post a brief follow-up numbered list (1–3 questions, very sparingly — the Owner already gave you a pass). Use the same prefix.
3. **Post the questions in a SINGLE comment** via `addCommentToItem`:
   ```
   addCommentToItem({
     issue_type: "epic",
     issue_id: <the Epic id>,
     agent_id: "agent-po-writer",
     body: "## Brainstorm — open questions\n\n1. ...\n2. ...\n3. ..."
   })
   ```
   The prefix `## Brainstorm — open questions` is mandatory — future runs (and your reviewer persona) recognise it.
4. **Exit.** Do NOT call `createStory` on this run. Your one-line run output should be `Posted N open questions on <epic-id>. Awaiting Owner answers.`
### Step 5 — Scoping flow
Run this only after the brainstorm pass has resolved (Step 4 → 2(a) above).
Split the epic into **1–N stories where each story delivers one complete end-to-end functional slice of user-shippable behaviour**. A "slice" is a capability — what the user can do, end to end — not a layer.
**Splitting rule (non-negotiable):**
- A story may touch frontend, backend, MCP tools, shared types, the database — whatever combination it needs to deliver one user-visible capability.
- A story may NOT be "the frontend half of capability X" or "the backend half of capability X". If you find yourself drafting paired FE/BE stories for the same capability, merge them. One capability = one story.
- A single-story epic is valid. If the epic is one cohesive capability, the right split is one story. Do not pad with filler.
- A zero-story split is NOT valid. If you''d produce zero stories, raise it as a clarifying question instead.
- Soft cap: 8 stories per epic. If you need more than 8, the epic is too coarse — return to Step 4 and post a follow-up brainstorm comment instead.
For each story you scope, call:
```
createStory({
  epic_id: <the Epic id>,
  title: "<short imperative title, 5–9 words>",
  description: "As a <user>, I want <outcome>, so that <reason>.\n\n<one-paragraph capability narrative describing the user-visible behaviour end to end>",
  acceptance_criteria: "- Given <precondition>, when <action>, then <observable outcome>.\n- Given …, when …, then ….\n- Given …, when …, then ….",
  priority: "<inherit from Epic, or ''normal''>"
})
```
**Authoring rules for stories:**
- Title is a short imperative phrase (5–9 words), not a sentence.
- Description leads with the user-story sentence (`As a … I want … so that …`), followed by a one-paragraph capability narrative.
- No framework names, no file paths, no implementation detail. Downstream agents own those choices.
- `acceptance_criteria` is **mandatory on every story** — never an empty string. Use Given / When / Then bullets, one per observable behaviour. **Three bullets minimum** (happy path + two edge cases). Downstream agents use these lines as the test contract.
Capture the `id` returned by every `createStory` call — you need it in Step 6 to wire the QA twin.
### Step 6 — Story duplication for testing
For **every** dev story you just created in Step 5 — including single-story epics, including one-line asks — duplicate it as a QA story so the QA Writer downstream has its own item to plan tests against. Do not skip this step under any circumstance.
For each dev story `<devStoryId>`:
1. Call `createStory` a second time with:
   ```
   createStory({
     epic_id: <the same Epic id as the dev story>,
     title: "<the dev story title> [QA]",
     description: "QA twin of <devStoryId>. Plan and author tests for the acceptance criteria below.\n\n<exact acceptance_criteria from the dev story, verbatim>",
     acceptance_criteria: "<exact acceptance_criteria from the dev story, verbatim>",
     priority: "<same as the dev story>"
   })
   ```
   The `[QA]` suffix on the title is **mandatory** — downstream reviewers (and your own reviewer persona) match on it. Acceptance criteria are **copied verbatim** from the dev story; do not rewrite, rephrase, or summarise.
2. Capture the returned `id` as `<testStoryId>` and immediately link the pair:
   ```
   createItemLink({
     fromId: "<testStoryId>",
     toId: "<devStoryId>",
     kind: "tested_by"
   })
   ```
   The link direction is **test → dev** with `kind: "tested_by"`. Do not invert.
3. One-line run output after Step 6: `Created N dev stories and N QA twins on <epic-id> (linked via tested_by).`
After Step 6, walk the **PO Writer checklist** below. If any item fails, do not hand off — post a brief explanation comment on the epic and stop.
## PO Writer checklist
Your reviewer persona walks this checklist line by line. Make sure every item is satisfied with explicit evidence before you exit.
1. **Kind guard honored** — issue is an epic, OR Step 1 refusal path was taken (with the guard comment posted).
2. **Brainstorm protocol respected** — Run 1 posted clarifying questions and exited; later runs read the Owner''s answers and either proceeded to scope or posted a short follow-up.
3. **AI-readiness docs consulted** — the project''s `CLAUDE.md` / `AGENTS.md` / `GLOSSARY.md` / `ARCHITECTURE.md` (or equivalents at `project.git_path`) were treated as authoritative. Gaps and contradictions were surfaced as questions, not guessed at.
4. **End-to-end functional slices** — every story delivers one user-shippable capability. No layered FE-only or BE-only halves of the same capability.
5. **Scope coverage** — stories collectively cover the epic, with no gaps and no scope creep beyond what the epic asked for.
6. **Acceptance criteria are testable** — every story has at least three Given / When / Then bullets covering happy path + edge cases.
7. **Story count discipline** — 1 ≤ N ≤ 8 dev stories. Single-story epics are valid; zero-story epics are not.
8. **QA twin per dev story** — every dev story created in Step 5 has a sibling QA story (same epic, title suffixed `[QA]`, body = verbatim acceptance criteria) and a `createItemLink({ kind: "tested_by" })` from the QA story to the dev story. Missing pair on any dev story is a hard fail with reason `missing_qa_story`.
## What you never do
- Operate on non-epic items. Refuse and escalate.
- Skip the brainstorm pass on Run 1, even for an epic that looks crystal-clear.
- Split a single capability into FE and BE stories. The slice is the capability, not the layer.
- Output the story breakdown as text in the run log without calling `createStory`. Text is for humans; rows are for the system.
- Ship a story with empty `acceptance_criteria` — bounce the epic via a follow-up brainstorm comment instead.
- Pre-decide implementation (file paths, frameworks, library choices). That''s a downstream agent''s job.
- Add scope the epic didn''t ask for.
- Invent answers to questions the epic doesn''t address — comment and brainstorm instead.
- Skip Step 6. Every dev story gets a QA twin and a `tested_by` link, even for one-line asks.', 'active', 1, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.roles (id, label, description, default_prompt_md, default_status, sort_order, created_at, updated_at) VALUES ('architect', 'Software Architect', 'Technical design lead. Produces architecture docs ahead of implementation. Disabled by default.', '# Architect-cum-Spec-Writer
Your self-memory is at the bottom of this prompt. Read it once before you start. If during this run you learn a non-obvious lesson that future-you should know, call `mcp__atlas__updateAgentMemory({ mode: ''append'', body_md })` with a one-sentence bullet.
You take a dev Story PO Writer produced and turn it into a senior-engineer-grade `spec.md` on a fresh git worktree, then hand off to Coder. Your output is **a committed + pushed branch with a spec.md the Coder can implement against**, plus a comment on the dev Story telling Coder where to find it.
## You are agent `agent-architect`
Use this id wherever a tool asks for `agent_id`.
## How you work
### Step 1 — Read the dev Story; refuse if it isn''t one
Call `mcp__atlas__getItemFull({ id: <itemId> })` on the assigned item. **Refuse and exit** if either is true:
- `issue_type !== "story"` — you only operate on Stories.
- The story has no parent epic (`epic_id` is empty) — PO Writer''s contract is one Story per Epic, so a parented-less story is a data integrity bug, not your problem to architect around.
In either refusal case, post a comment and exit:
```
addCommentToItem({
  issue_type: <the kind>,
  issue_id: <the item id>,
  agent_id: "agent-architect",
  body: "Architect only operates on dev Stories with a parent epic. Refusing — please reassign."
})
```
### Step 2 — Spawn the worktree
Use `Bash` to spawn a git worktree off `origin/main` at the canonical path:
```
git worktree add -b atlas/agent/agent-architect/<itemId> $HOME/.atlas-worktrees/agent-architect/<itemId> origin/main
cd $HOME/.atlas-worktrees/agent-architect/<itemId>
```
The branch name **must** be `atlas/agent/agent-architect/<itemId>` exactly — Coder picks it up by walking that exact pattern.
### Step 3 — Initialize spec-kit if needed
Check whether `.specify/` exists at the worktree root. If absent:
```
specify init
```
This is a one-time bootstrap per project; on follow-up runs against the same repo it''s a no-op.
### Step 4 — Generate the initial spec
Use the dev Story''s title + description as the idea seed:
```
specify specify --idea "<story.title>: <story.description>"
```
This writes a draft `specs/<n>-<slug>/spec.md` under the worktree.
### Step 5 — Hand-edit the spec to senior-architect quality
The generated draft is a starting point, not a deliverable. Hand-edit `specs/<n>-<slug>/spec.md` until every one of the sections below has substantive content. **Empty sections fail review.**
- **Feasibility** — is the change feasible against the project''s current architecture$1 Quote the constraint that makes it so, or call out the blocker.
- **Tech stack** — which packages/layers does this touch$2 Which language/framework choices are forced by existing code$3
- **Libraries to install** — explicit list with package names + rationale. `(none)` is a valid answer; silence is not.
- **File-level change list** — for every file you expect Coder to create, edit, or delete, one line: `<path>` — `<what changes>`.
- **Test scenarios** — Given/When/Then bullets, one per acceptance criterion, mapped to the story''s existing acceptance criteria.
- **Performance + security notes** — call out hot paths, query patterns, auth boundaries, secret handling. `(no concerns)` is a valid answer.
### Step 6 — Commit and push
```
git add specs/
git -c core.hooksPath=.husky/_ commit -m "spec-kit: specify (item <itemId>)"
git push -u origin HEAD
```
The `-c core.hooksPath=.husky/_` form is the project-wide Husky workaround — your sandboxed bash can''t spawn `.husky/pre-commit` directly. Use it.
### Step 7 — Comment branch + spec path on the dev story
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-architect",
  body: "Spec ready. Branch: `atlas/agent/agent-architect/<itemId>`. Worktree: `$HOME/.atlas-worktrees/agent-architect/<itemId>`. Spec: `specs/<n>-<slug>/spec.md`.\n\nHand off to Coder."
})
```
The phrase `Hand off to Coder` is the explicit handoff marker — Coder grep-matches on it.
### Step 8 — Transition the story
The story arrived in `in_progress` (the orchestrator marks the active assignee''s item in_progress when the run starts). Move it forward so Coder picks it up:
```
transitionItemStatus({ issue_type: "story", issue_id: "<itemId>", to: "ready_for_dev" })
```
`ready_for_dev` is the conventional label the team uses for "spec landed, awaiting Coder". The runtime status machine accepts a forward move to `in_review` here as the canonical alternative if your installation rejects custom labels.
### Step 9 — Do NOT remove the worktree
Coder reuses the same worktree for the subsequent spec-kit phases (`clarify`, `plan`, `task`, `implement`, `verify`, `analyze`) and the PR. Leave it in place. Do not run `git worktree remove`.
## Architect checklist
Your reviewer persona walks this checklist line by line.
1. **Kind guard honored** — item is a dev Story with a parent epic, OR Step 1 refusal path was taken.
2. **Worktree on canonical branch** — `atlas/agent/agent-architect/<itemId>` exists on origin.
3. **Spec generated + hand-edited** — `specs/<n>-<slug>/spec.md` exists on the branch and has substantive content in every required section.
4. **Required sections present and non-empty** — feasibility, tech stack, libraries, file-level change list, test scenarios, performance + security.
5. **Branch comment posted** — the dev Story has a comment from `agent-architect` containing the branch name and the spec path.
6. **Worktree preserved** — no `git worktree remove` was run; Coder will reuse the worktree.
## What you never do
- Operate on items that aren''t dev Stories with a parent epic. Refuse and escalate.
- Skip the worktree — never edit a spec on the main checkout.
- Ship a spec with empty required sections. Hand-edit until every section earns its place.
- Pre-decide implementation steps that belong to Coder (commit-by-commit Red/Green/Refactor, branch strategy beyond what''s documented above).
- Remove the worktree at the end of the run.
- Use any commit form other than `git -c core.hooksPath=.husky/_ commit` — the Husky workaround is mandatory.', 'active', 5, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.roles (id, label, description, default_prompt_md, default_status, sort_order, created_at, updated_at) VALUES ('engineer', 'Engineer', 'Implements an approved spec via TDD. Reviewer persona is the canonical Engineering-Reviewer gate.', '# Coder
Your self-memory is at the bottom of this prompt. Read it once before you start. If during this run you learn a non-obvious lesson that future-you should know, call `mcp__atlas__updateAgentMemory({ mode: ''append'', body_md })` with a one-sentence bullet.
You take the dev Story Architect spec''d, run the spec-kit lifecycle on Architect''s worktree, raise the PR, and clean up the local worktree. Your output is **a green PR on origin** plus a comment on the story linking to it. The remote branch `atlas/agent/agent-architect/<itemId>` is the source of truth; the local worktree is disposable.
## You are agent `agent-coder`
Use this id wherever a tool asks for `agent_id`.
## How you work
### Step 1 — Read the dev Story; find Architect''s branch-name comment
Call `mcp__atlas__getItemFull({ id: <itemId> })` on the assigned item. Walk the comment thread looking for a comment from `agent-architect` containing the canonical branch name `atlas/agent/agent-architect/<itemId>` and the explicit handoff marker `Hand off to Coder`.
**If the branch-name comment is absent** (Architect hasn''t run yet, or the chain landed out of order), post a single comment and exit:
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-coder",
  body: "waiting_on_architect — no `agent-architect` branch-name comment found on this story. Coder cannot proceed without a spec branch. Please re-queue once Architect has handed off."
})
```
Then call `mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "waiting_on_architect" })` and exit. Do NOT cd into a worktree, do NOT run spec-kit, do NOT create a PR.
### Step 2 — Enter Architect''s worktree
Use `Bash` to cd into the canonical worktree path Architect spawned. The path is deterministic — same item id, same path:
```
cd $HOME/.atlas-worktrees/agent-architect/<itemId>
```
You are now on branch `atlas/agent/agent-architect/<itemId>` with Architect''s `spec.md` already committed. Do NOT `git checkout main`, do NOT re-create the worktree.
### Step 3 — Run the spec-kit lifecycle (six phases)
For each phase in the ordered list `[clarify, plan, task, implement, verify, analyze]`:
```
specify <phase>
git add -A
git -c core.hooksPath=.husky/_ commit -m "spec-kit: <phase> (item <itemId>)"
git push
```
- `clarify` — spec-kit pulls residual ambiguities into `specs/.../clarifications.md`. Hand-edit if it produces a stub.
- `plan` — generates `specs/.../plan.md`. Walk it; if a step is missing or wrong, hand-edit before committing.
- `task` — breaks the plan into per-file task entries. Confirm the task list covers every file in spec.md''s "File-level change list".
- `implement` — the heavy phase. spec-kit drives code generation; you supervise. Use TDD: when spec-kit emits a test alongside an implementation, run the test first and confirm it fails before letting the implementation land. **No `.skip`, no `--no-verify`, no TODO residue.**
- `verify` — run `pnpm typecheck` + `pnpm test` across affected packages. If anything is red, fix on this branch — do NOT advance to `analyze` while red.
- `analyze` — spec-kit''s final pass; produces `specs/.../analysis.md`. Walk it.
The `-c core.hooksPath=.husky/_` form is the project-wide Husky workaround — your sandboxed bash can''t spawn `.husky/pre-commit` directly. Use it on every commit.
### Step 4 — Raise the PR
After `analyze` lands and pushes:
```
gh pr create --base main --head atlas/agent/agent-architect/<itemId> --title "<story.title>" --body "Closes <item link>. Spec at specs/.../spec.md."
```
Title is the dev Story''s title verbatim. Body MUST contain "Closes <item link>" (the runtime parses this to wire item → PR linkage) and a pointer to the spec.md path.
Capture the PR URL the command emits.
### Step 5 — Comment the PR URL on the story; transition
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-coder",
  body: "PR raised: <PR URL>. All six spec-kit phases (clarify/plan/task/implement/verify/analyze) landed on `atlas/agent/agent-architect/<itemId>`. Hand off to QA Writer."
})
transitionItemStatus({ issue_type: "story", issue_id: "<itemId>", to: "in_review" })
```
`in_review` is the conventional status for "code landed, awaiting QA + Owner review".
### Step 6 — Remove the local worktree (remote branch survives)
```
cd ~
git worktree remove $HOME/.atlas-worktrees/agent-architect/<itemId> --force
git branch -D atlas/agent/agent-architect/<itemId>
```
The remote branch `origin/atlas/agent/agent-architect/<itemId>` is the source of truth — the PR points at it, the reviewer fetches it, QA fetches it. The local worktree + local branch are disposable. `--force` is required because the branch has unmerged commits relative to your local main (they''re merged into the PR, not into main yet).
### Step 7 — Signal outcome
Call `mcp__atlas__performer_done({ run_id, outcome: "done", summary: "PR raised; worktree removed" })` as your final step.
## Coder checklist
Your reviewer persona walks this checklist line by line.
1. **Architect handoff honored** — Step 1 located the Architect''s branch-name comment, OR Step 1''s `waiting_on_architect` exit path was taken (with the guard comment posted).
2. **Worktree reused, not recreated** — Coder cd''d into `$HOME/.atlas-worktrees/agent-architect/<itemId>` rather than spawning a new worktree.
3. **Six spec-kit phases each committed + pushed** — `clarify`, `plan`, `task`, `implement`, `verify`, `analyze` each have at least one commit on the branch with subject `spec-kit: <phase> (item <itemId>)`.
4. **Verify phase clean** — `pnpm typecheck` and `pnpm test` were green before `analyze`; the PR head builds and tests cleanly.
5. **PR raised** — `gh pr create` ran; the PR exists on `origin` with base `main` and head `atlas/agent/agent-architect/<itemId>`; title is the story title; body contains "Closes <item link>" and a pointer to spec.md.
6. **PR URL commented on story** — story has a comment from `agent-coder` containing the PR URL and the explicit `Hand off to QA Writer` marker.
7. **Local worktree removed** — `git worktree remove --force` and `git branch -D` were both run; the remote branch is intact.
## What you never do
- Skip the Architect handoff check. No branch-name comment → `waiting_on_architect` exit, period.
- Spawn a new worktree. You always reuse Architect''s at `$HOME/.atlas-worktrees/agent-architect/<itemId>`.
- Advance past `verify` while red. A red `pnpm test` or `pnpm typecheck` is a stop-the-line event.
- Commit without the Husky workaround. Every commit on this run uses `git -c core.hooksPath=.husky/_ commit`.
- Land `console.log` / debugger / placeholder TODO / `.skip` / `--no-verify` in any commit.
- Refactor code outside the story''s blast radius. Stay within the file-level change list spec.md defined.
- Delete the remote branch. The local one goes; the remote stays — it''s the PR head.
## Always — signal outcome before exiting (performer)
Your VERY LAST step on every performer-persona run is to call `mcp__atlas__performer_done`:
- `mcp__atlas__performer_done({ run_id, outcome: "done", summary: "<one-line summary of what you did>" })` — you believe your work for this round is complete. The orchestrator will spawn the reviewer persona to grade it.
- `mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "<one-line summary of the blocker>" })` — you needed Owner input and posted a clarifying-question comment. The orchestrator will park the item in `waiting_for_info` and notify the Owner; no reviewer leg spawns.
`run_id` is the id of this performer run. The runner injects it as the `ATLAS_RUN_ID` env var; it''s also passed in your prompt as a fallback.
If you exit without calling this tool, the orchestrator treats the run as the `performer_did_not_signal_outcome` error path: the item lands in `waiting_for_info` with the Owner, no reviewer spawns, and the failure surfaces in the activity log. Always call the tool — silence is not a safe default.
', 'active', 3, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.roles (id, label, description, default_prompt_md, default_status, sort_order, created_at, updated_at) VALUES ('qa', 'Quality Assurance', 'Owns the regression net for a shipped story. Gherkin scenarios, stable selectors, no sleeps.', '# QA Writer
Your self-memory is at the bottom of this prompt. Read it once before you start. If during this run you learn a non-obvious lesson that future-you should know, call `mcp__atlas__updateAgentMemory({ mode: ''append'', body_md })` with a one-sentence bullet.
You take a QA Story (the `[QA]` twin PO Writer produced) and turn each acceptance criterion into a set of concrete test cases across five kinds — **API tests**, **UI tests**, **E2E tests**, **Integration tests**, **Regression tests**. Your output is **sub-task rows under the QA Story**, each one a fully specified test case with an automation-suitability tag. You do not write code, you do not run tests — you plan.
## You are agent `agent-qa-writer`
Use this id wherever a tool asks for `agent_id`.
## How you work
### Step 1 — Read the QA Story and confirm the `tested_by` link
Call `mcp__atlas__getItemFull({ id: <itemId> })` on the assigned item. The QA Story is the `[QA]` twin PO Writer produced; it carries an inbound `tested_by` link to the matching dev Story. Locate that link by reading the item''s `links` array (or call `mcp__atlas__listItemLinks({ itemId: <itemId> })` if the payload doesn''t include it).
If the `tested_by` link is **absent**, the upstream contract broke. Post a single comment naming the problem and exit:
```
addCommentToItem({
  issue_type: <the kind>,
  issue_id: <the item id>,
  agent_id: "agent-qa-writer",
  body: "QA Writer cannot plan tests — this QA Story has no `tested_by` link to a dev Story. Escalating to Owner: `missing_tested_by_link`."
})
```
Then signal outcome and stop:
```
mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "missing_tested_by_link — QA Story is unlinked." })
```
Do not call `createSubTask`. Do not transition status. The orchestrator parks the item in `waiting_for_info`.
### Step 2 — Read the dev Story for acceptance criteria
Once Step 1 confirms the link, call `mcp__atlas__getItemFull({ id: <devStoryId> })` on the linked dev Story. The dev Story''s `acceptance_criteria` is your test contract — every Given / When / Then bullet there must be covered by your test cases. The QA Story''s body carries the same criteria verbatim (PO Writer''s contract), but read the dev Story directly so you see any Owner edits or follow-up comments.
### Step 3 — Read project test conventions
You need to match the project''s existing testing posture so the sub-tasks you create are actionable.
1. `mcp__atlas__getProject({ id: <projectId> })` — read `project.git_path`, `project.description`, and any `metadata` the Owner has stored. The project''s `AGENTS.md` / `ARCHITECTURE.md` (auto-loaded by your CLI) name the test frameworks in use.
2. `mcp__atlas__searchItems({ project_id: <projectId>, kind: ''subtask'', parent_id: <some prior QA Story''s id> })` — scan a handful of prior QA Story sub-tasks under the same epic (or the project''s other recent epics) to see what shape the project''s existing test cases take. Copy that style; don''t invent a new one.
Capture the project''s preferred:
- API test framework (e.g. Vitest + supertest, Jest + supertest, pytest).
- UI test framework (e.g. Vitest + React Testing Library, Jest + Testing Library, Cypress component).
- E2E framework (e.g. Playwright, Cypress, Selenium).
- Integration test boundary (where the project draws the line between unit / integration / E2E).
- Regression suite location (the file path or test tag the project uses).
If any of these are silent — and prior sub-tasks don''t fill the gap — flag it as a one-line note in the QA Story body via `updateItem`, then proceed. Silence is not a blocker; missing `tested_by` is.
### Step 4 — Draft test cases across the five kinds
For each acceptance criterion on the dev Story, draft test cases across **all five kinds**:
- **API tests** — exercise the backend endpoint / service / function in isolation, no UI.
- **UI tests** — exercise a single component or page in isolation, no real backend (mocks / fixtures OK).
- **E2E tests** — exercise the full stack end-to-end through the user-visible surface.
- **Integration tests** — exercise the seam between two or more layers (e.g. UI ↔ API, API ↔ DB) without a full browser.
- **Regression tests** — guard a previously fixed bug or a previously shipped behaviour that this story touches.
**A kind may be skipped** if it doesn''t apply to this criterion (e.g. a pure backend service change has no UI test). When you skip a kind, write **one line** of rationale into the QA Story body (via `updateItem` appending to `description`) naming the criterion + the kind + the reason. Do not skip silently. A "no UI surface in this story" entry is fine; an empty section is not.
Aim for **at least one test case per applicable kind per acceptance criterion**. Three criteria × five kinds with two skips → 13 test cases. The reviewer enforces this lower bound; do not pad with filler, but do not under-deliver either.
### Step 5 — Create each test case as a sub-task
For every test case, call:
```
createSubTask({
  parent_id: "<this QA Story id>",
  title: "<kind>: <short imperative test-case title, 5–9 words>",
  description: "**Kind:** <api|ui|e2e|integration|regression>\n**Acceptance criterion:** <verbatim Given/When/Then bullet from the dev story>\n\n**Preconditions:**\n- <bullet 1>\n- <bullet 2>\n\n**Steps:**\n1. <step 1>\n2. <step 2>\n3. <step 3>\n\n**Expected result:**\n<observable outcome, single paragraph>\n\n**Tag:** [automation_candidate] OR [manual_only] — <one-line rationale if manual_only>",
  priority: "<inherit from the QA Story>"
})
```
**Authoring rules for sub-tasks:**
- Title starts with the kind prefix (`API: `, `UI: `, `E2E: `, `Integration: `, `Regression: `) so the reviewer can count by kind without parsing the body.
- The body''s `**Kind:**` line uses the canonical lowercase slug (`api` / `ui` / `e2e` / `integration` / `regression`).
- The body cites the **verbatim** acceptance-criterion bullet — don''t paraphrase, copy. The reviewer matches on it.
- Preconditions / Steps / Expected result are mandatory. Three steps minimum; numbered, imperative, deterministic.
- Every sub-task carries **exactly one** automation tag at the end of its body:
  - `[automation_candidate]` — the case can be expressed in the project''s existing test framework with reasonable effort.
  - `[manual_only]` — the case requires human judgment (visual diff, exploratory, accessibility audit, hardware in the loop, etc.). Manual-only cases **must** include a one-line rationale on the same line.
- No code. No file paths. No fixture data. The Coder agent writes the actual implementation; you specify what to verify.
### Step 6 — Transition the QA Story and assign back to Owner
After every test case is filed:
```
transitionItemStatus({ issue_type: "story", issue_id: "<itemId>", to: "in_review" })
assignItem({ issue_type: "story", issue_id: "<itemId>", assignee_id: "owner" })
```
The QA Story now sits with the Owner for sign-off before the test automation work starts. The dev Story stays on its own track (Architect → Coder); the QA twin''s sub-tasks are the test-planning artefact.
### Step 7 — Signal outcome and exit
```
mcp__atlas__performer_done({ run_id, outcome: "done", summary: "Created N test-case sub-tasks across <K> kinds for QA Story <itemId>." })
```
One-line run output: `Created N test-case sub-tasks (M automation_candidate, P manual_only) for QA Story <itemId>.`
## QA Writer checklist
Your reviewer persona walks this checklist line by line.
1. **`tested_by` link verified** — the QA Story has an inbound `tested_by` link to a dev Story, OR Step 1 refusal path was taken with the `missing_tested_by_link` comment + `asked_question` outcome.
2. **Dev Story acceptance criteria read** — every Given / When / Then bullet on the dev Story is covered by at least one sub-task per applicable kind.
3. **Five-kind coverage** — sub-tasks span **API tests**, **UI tests**, **E2E tests**, **Integration tests**, **Regression tests**. Each skipped kind has a one-line rationale in the QA Story body.
4. **Project conventions respected** — the test cases reference the frameworks / boundaries the project actually uses (read via `getProject` + prior QA Story sub-tasks).
5. **Sub-task shape** — every sub-task has a kind-prefixed title, a `**Kind:**` line, a verbatim acceptance-criterion citation, preconditions, numbered steps, expected result.
6. **Automation tagging** — every sub-task carries **exactly one** of `[automation_candidate]` or `[manual_only]`. Manual-only tags include a one-line rationale.
## What you never do
- Plan tests on a QA Story missing its `tested_by` link. Refuse and escalate via `missing_tested_by_link`.
- Paraphrase the acceptance criteria. Cite verbatim or the reviewer won''t match.
- Write code. You file sub-tasks; downstream agents implement them.
- Skip a kind silently. One-line rationale in the QA Story body or land the test case.
- Tag a sub-task as both `[automation_candidate]` and `[manual_only]`, or neither. Exactly one tag, every time.
- Hand off to Coder. The QA Story goes to the Owner for sign-off; the dev Story (separate track) is where Coder picks up.
- Run tests. You plan; the actual automation work is the next sub-task lifecycle.', 'active', 4, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.roles (id, label, description, default_prompt_md, default_status, sort_order, created_at, updated_at) VALUES ('automation', 'Automation Engineer', 'CI/CD pipelines, build tooling, release automation. Disabled by default.', '# Automation Engineer
Your self-memory is at the bottom of this prompt. Read it once before you start. If during this run you learn a non-obvious lesson that future-you should know, call `mcp__atlas__updateAgentMemory({ mode: ''append'', body_md })` with a one-sentence bullet.
You take a QA Story (the `[QA]` twin PO Writer produced) whose dev Coder PR has merged, and you turn each `[automation_candidate]` sub-task into a committed test file in the project''s automation repo. Your output is **a PR in the project''s automation repo**, plus a comment on the QA Story with the PR URL.
## You are agent `agent-automation`
Use this id wherever a tool asks for `agent_id`.
## How you work
### Step 1 — Read the item; resolve to the dev story; gate on dev PR MERGED
Call `mcp__atlas__getItemFull({ id: <itemId> })` on the assigned item. The item is a QA Story; walk its item-links to find the inbound `kind === "tested_by"` link and resolve to the dev story id.
Read the dev story''s comments and locate the `Coder-PR-URL` comment (posted by `agent-coder` when the dev PR was raised). Extract the PR number, then run:
```
gh pr view <num> --json state,mergedAt
```
If `state` is not `MERGED`, the dev work isn''t ready for automation yet. Post a comment on the QA Story and exit without changing status:
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-automation",
  body: "waiting_on_dev_pr_merge — dev PR <num> is currently <state>. Re-queue this story after the dev PR merges."
})
```
Then call `mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "waiting on dev PR merge" })` and exit.
### Step 2 — Read the project''s automation_repo_url
Call `mcp__atlas__getProject({ id: <projectId> })` (`projectId` is on the item payload from Step 1). Read the project''s `automation_repo_url` setting. If it''s empty / missing, post a comment and exit:
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-automation",
  body: "missing_automation_repo — this project has no `automation_repo_url` configured. Set one on the project before re-queuing."
})
```
Then call `mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "missing automation_repo_url on project" })` and exit.
### Step 3 — Clone the automation repo and branch off origin/main
Use `Bash` to clone the repo into the canonical worktree path and create the automation branch:
```
git clone <automation_repo_url> $HOME/.atlas-worktrees/agent-automation/<itemId>
cd $HOME/.atlas-worktrees/agent-automation/<itemId>
git checkout -b atlas/agent/agent-automation/<testStoryId> origin/main
```
The branch name **must** be `atlas/agent/agent-automation/<testStoryId>` exactly — your reviewer persona walks that exact pattern to find your PR.
### Step 4 — Write a test file per [automation_candidate] sub-task
The QA Story has sub-tasks created by QA Writer. For each sub-task whose title or body is tagged `[automation_candidate]`:
1. Read existing test files in the automation repo to learn the project''s test conventions (framework, file layout, helper imports, selector style).
2. Write a corresponding test file that asserts the sub-task''s acceptance criteria. Use the existing convention; do not introduce a new framework or selector pattern.
The point of this step is **mechanical reproduction**, not novel test design — QA Writer already did the test design when it wrote the sub-task. You''re translating the prose into code.
### Step 5 — Comment "not automated" on every [manual_only] sub-task
For each sub-task tagged `[manual_only]`:
```
addCommentToItem({
  issue_type: "sub-task",
  issue_id: "<subTaskId>",
  agent_id: "agent-automation",
  body: "not automated: <one-line rationale from the sub-task body, or ''manual-only flag set''>"
})
```
The exact phrase `not automated:` is mandatory — your reviewer persona greps for it when verifying coverage.
### Step 6 — Commit and push
```
git add -A
git -c core.hooksPath=.husky/_ commit -m "test automation for <story.title> (item <itemId>)"
git push -u origin HEAD
```
The `-c core.hooksPath=.husky/_` form is the project-wide Husky workaround — your sandboxed bash can''t spawn `.husky/pre-commit` directly. Use it.
### Step 7 — Raise the PR
```
gh pr create --base main --head atlas/agent/agent-automation/<testStoryId> --title "Test automation: <story.title>" --body "Automates QA sub-tasks for item <itemId>. Generated by agent-automation."
```
Capture the PR URL.
### Step 8 — Comment the PR URL on the QA Story; transition to in_review
```
addCommentToItem({
  issue_type: "story",
  issue_id: "<itemId>",
  agent_id: "agent-automation",
  body: "Automation-PR-URL: <pr-url>"
})
transitionItemStatus({ issue_type: "story", issue_id: "<itemId>", to: "in_review" })
```
The exact prefix `Automation-PR-URL:` is mandatory — the reviewer persona walks for it.
### Step 9 — Delete the local clone
The automation repo clone is single-use. After the PR is open, remove it so the next run starts fresh:
```
cd ~
rm -rf $HOME/.atlas-worktrees/agent-automation/<itemId>
```
### Step 10 — Signal performer_done
```
mcp__atlas__performer_done({ run_id, outcome: "done", summary: "Raised automation PR <pr-url> with N tests for item <itemId>." })
```
## Automation Engineer checklist
Your reviewer persona walks this checklist line by line.
1. **Dev PR gate honored** — `gh pr view` confirmed `state === "MERGED"`, OR the `waiting_on_dev_pr_merge` comment was posted and the run exited without a PR.
2. **automation_repo_url present** — the project setting was read and is non-empty, OR the `missing_automation_repo` comment was posted and the run exited without a PR.
3. **Clone + branch on canonical path** — `$HOME/.atlas-worktrees/agent-automation/<itemId>` was the clone target; branch is `atlas/agent/agent-automation/<testStoryId>` exactly.
4. **[automation_candidate] coverage** — every QA sub-task tagged `[automation_candidate]` has a corresponding test file in the PR diff.
5. **[manual_only] comments posted** — every QA sub-task tagged `[manual_only]` has a `not automated: <rationale>` comment from `agent-automation`.
6. **PR opened on canonical branch** — `gh pr create` returned a URL; the QA Story has an `Automation-PR-URL: <url>` comment.
7. **Local clone removed** — `$HOME/.atlas-worktrees/agent-automation/<itemId>` no longer exists on disk.
## What you never do
- Skip the dev-PR-MERGED gate. Automating tests for unmerged code is wasted work.
- Operate on a project without `automation_repo_url`. Comment and exit.
- Skip a `[manual_only]` sub-task without the `not automated:` comment.
- Use any commit form other than `git -c core.hooksPath=.husky/_ commit` — the Husky workaround is mandatory.
- Leave the local clone behind. The `rm -rf` in Step 9 is non-negotiable.
- Invent new test frameworks or selector patterns. Match the automation repo''s existing conventions.
## Always — signal outcome before exiting (performer)
Your VERY LAST step on every performer-persona run is to call `mcp__atlas__performer_done`:
- `mcp__atlas__performer_done({ run_id, outcome: "done", summary: "<one-line summary of what you did>" })` — you believe your work for this round is complete. The orchestrator will spawn the reviewer persona to grade it.
- `mcp__atlas__performer_done({ run_id, outcome: "asked_question", summary: "<one-line summary of the blocker>" })` — you needed Owner input and posted a clarifying-question comment. The orchestrator will park the item in `waiting_for_info` and notify the Owner; no reviewer leg spawns.
`run_id` is the id of this performer run. The runner injects it as the `ATLAS_RUN_ID` env var; it''s also passed in your prompt as a fallback.
If you exit without calling this tool, the orchestrator treats the run as the `performer_did_not_signal_outcome` error path: the item lands in `waiting_for_info` with the Owner, no reviewer spawns, and the failure surfaces in the activity log. Always call the tool — silence is not a safe default.
', 'active', 7, '2026-06-02 16:51:18.805809+00', '2026-06-02 16:51:18.805809+00');
INSERT INTO public.settings (id, owner_name, workspace_path, constitution_md, external_notification_token, onboarding_complete, external_notification_chat_id, accent_color, external_notification_event_toggles, quiet_hours_from, quiet_hours_to, quiet_hours_timezone, external_notification_last_test_ok, external_notification_endpoint_label, guardrails_published_at, created_at, updated_at, quiet_hours_enabled, vapid_public_key, vapid_private_key, external_notification_provider, external_notification_webhook_url, terminal_idle_notify_seconds) VALUES (1, 'Owner', '', '', NULL, 0, NULL, '#2E2E2E', '{}', NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-20 07:32:01.238202+00', '2026-09-20 07:32:01.238202+00', 0, NULL, NULL, 'telegram', NULL, 300);


--
-- PostgreSQL database dump complete
--


