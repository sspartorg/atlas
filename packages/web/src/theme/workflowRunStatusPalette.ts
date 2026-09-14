// ADR 0014 — workflow-run status sibling of `runStatusPalette.ts`. Each
// status borrows the item-status hue it maps onto (running ↔ in_progress,
// waiting_for_owner ↔ waiting_for_info, completed ↔ done) so a run pill and
// the item it drives read as the same colour; cancelled/error reuse the
// agent-run pastels.

import type { WorkflowRunStatus } from '@atlas/shared';
import { STATUS_PALETTE, type StatusPaletteEntry } from './tokens.js';
import { RUN_STATUS_PALETTE } from './runStatusPalette.js';

function entry(label: string, from: Omit<StatusPaletteEntry, 'label'> | undefined): StatusPaletteEntry {
    /* v8 ignore next -- every key used below exists in its source palette */
    const src = from ?? RUN_STATUS_PALETTE.queued;
    return { label, bg: src.bg, fg: src.fg, dot: src.dot };
}

export const WORKFLOW_RUN_STATUS_PALETTE: Record<WorkflowRunStatus, StatusPaletteEntry> = {
    running: entry('Running', STATUS_PALETTE['in_progress']),
    waiting_for_owner: entry('Waiting for you', STATUS_PALETTE['waiting_for_info']),
    completed: entry('Completed', STATUS_PALETTE['done']),
    cancelled: entry('Cancelled', RUN_STATUS_PALETTE.cancelled),
    error: entry('Error', RUN_STATUS_PALETTE.error),
};

export const LIVE_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = ['running', 'waiting_for_owner'];
