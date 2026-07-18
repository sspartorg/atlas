import type {
    BugFailureScope,
    BugFrequency,
    IssuePriority,
    IssueStatus,
    IssueType,
} from '../types/index.js';

// Single unified item shape (mirrors the `items` table in Postgres after the
// SQLite → PG migration). All type-specific fields are nullable; consumers
// project rows into per-type shapes (IEpic / IStory / etc.) via helpers in
// @atlas/api's items service.
export interface IItem {
    id: string;
    project_id: string;
    type: IssueType;
    parent_id: string | null;
    parent_type: IssueType | null;

    title: string;
    description: string | null;
    status: IssueStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;

    priority: IssuePriority | null;

    spec_md: string | null;
    pr_url: string | null;
    points: number | null;

    acceptance_criteria: string | null;

    steps_to_reproduce: string | null;
    expected: string | null;
    actual: string | null;
    frequency: BugFrequency | null;
    failure_scope: BugFailureScope | null;
    detected_at: string | null;
    occurrence_count: number | null;
    occurrence_total: number | null;

    started_at: string | null;

    created_at: string;
    updated_at: string;
}

// Link relation taxonomy. `relates_to` is semantically undirected (the API
// normalizes pairs so duplicates in either direction collapse). `depends_on`
// is strictly directed — `from depends_on to` means `from` is blocked by `to`.
// `tested_by` is directed and agent-created — `from tested_by to` means
// `from` is the QA twin that tests `to` (the dev story). PO Writer is the
// canonical writer; surfaced read-only in the user-facing link picker.
export type ItemRelation = 'relates_to' | 'depends_on' | 'tested_by';

export const ITEM_RELATIONS: ItemRelation[] = ['relates_to', 'depends_on', 'tested_by'];

export interface IItemLink {
    id: number;
    from_id: string;
    to_id: string;
    relation_type: ItemRelation;
    created_at: string;
}

// Enriched link row for the UI — `type/item_id` always point at the OTHER end
// of the link relative to the page the user is on. `direction` is meaningful
// for depends_on (outgoing = "this item depends on …", incoming = "this item
// is depended-on by …"). Relates_to rows always come back with direction
// 'outgoing' since the relation is conceptually undirected.
export interface IItemLinkRow {
    id: number;
    relation_type: ItemRelation;
    direction: 'outgoing' | 'incoming';
    type: IssueType;
    item_id: string;
    short_id: string;
    title: string;
    status: IssueStatus;
    created_at: string;
}

// External link types live in ../types/index.ts alongside IIssueLink* (single
// concept, single home). Re-exported here so consumers that already import
// from '@atlas/shared/items' see the same symbols.
export type { ExternalLinkKind, IItemExternalLink } from '../types/index.js';
export { EXTERNAL_LINK_KINDS } from '../types/index.js';
