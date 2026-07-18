// P16 — Shared error handler for status PATCH calls.
//
// Per-kind hooks (`useTransitionStory`, `useTransitionEpic`, etc.) all hit
// `/api/<kind>/:id/status`, which can now return HTTP 422 with
// `{ kind: 'conflict', details: { parent_id, open_children } }` when the
// caller tries to close a parent that still has open children
// (status-machine rule `assertChildrenDone()`).
//
// We don't centralize the mutations themselves — the per-kind hooks already
// own cache-key invalidation and that surface is settled. Instead we expose
// `transitionItemOnError(toast, err)` which the per-kind hooks call from
// their `onError` so the Owner sees a single toast listing the offending
// child IDs rather than a silent failure.
//
// Why a hook file (`useTransitionItem.ts`) instead of a plain util: the
// referenced spec (P16 master plan) names this file explicitly, and keeping
// it under `hooks/` lets us later consolidate per-kind mutations behind a
// single composite hook without renaming.

import type { Toast } from './useToast.js';
import { AtlasApiError } from '../api/api.js';

interface ToastShow {
    show: (t: Omit<Toast, 'id'>) => void;
}

interface OpenChild {
    id: string;
    status: string;
}

interface ClosureBlockedDetails {
    parent_id?: string;
    open_children?: OpenChild[];
}

function isClosureBlocked(err: unknown): err is AtlasApiError {
    return (
        err instanceof AtlasApiError &&
        err.status === 422 &&
        err.kind === 'conflict' &&
        // Look for the P16 details shape so we don't swallow other 422s.
        typeof err.details === 'object' &&
        err.details !== null &&
        Array.isArray((err.details as ClosureBlockedDetails).open_children)
    );
}

/**
 * Show a toast describing the open children that are blocking parent
 * closure. No-op for any error shape that isn't the P16 closure-rule 422,
 * so the per-kind hook's other `onError` paths still run.
 *
 * Returns `true` when the error was handled (closure rule), `false`
 * otherwise — letting callers decide whether to chain a default handler.
 */
export function transitionItemOnError(toast: ToastShow, err: unknown): boolean {
    if (!isClosureBlocked(err)) return false;
    const details = err.details as ClosureBlockedDetails;
    const open = details.open_children ?? [];
    const ids = open.map((c) => c.id);
    const head = ids.slice(0, 3).join(', ');
    const more = ids.length > 3 ? ` and ${ids.length - 3} more` : '';
    toast.show({
        message: 'Cannot close — open children',
        detail:
            ids.length === 0
                ? err.message
                : `${head}${more} ${ids.length === 1 ? 'is' : 'are'} not done yet.`,
    });
    return true;
}
