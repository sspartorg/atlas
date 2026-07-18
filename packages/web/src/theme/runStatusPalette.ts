// 2026-06-10 — Shared pastel palette for agent_run statuses.
//
// Previously this lived as duplicated `RUN_STATUS_TONE` / `RUN_STATUS_COLOR`
// maps in OverviewTabContent, HistoryTabContent, RunsTabContent,
// AgentRunDetail, and AgentHero — each pulling from the Mercury brand-hue
// slots (`ATLAS_PALETTE.green`, `.cerulean`) which had been collapsed to
// black-in-light / white-in-dark accent. Result: status dots rendered as
// large black or white blobs instead of carrying any colour identity.
//
// Item statuses (draft/ready/...) live in STATUS_PALETTE; this is the
// run-status sibling. Hues match the item-status family so a "Completed"
// run pill and a "Done" issue pill read as the same calm sage.
//
// `bg` = chip fill (light pastel, readable as a tag on either theme).
// `fg` = legible text colour AND the accent-dot colour shown on top of
// the chip — same role `--atlas-success` plays for the LiveDot ripple.

import type { RunStatus } from '@atlas/shared';

export interface RunStatusPaletteEntry {
    /** Pale chip fill (used by the run-status pill). */
    bg: string;
    /** Deep tonal text on top of the pill. */
    fg: string;
    /**
     * Mid-saturation hue for small standalone dots. The bg+border combo
     * read as washy at 8–10px; `dot` is a single recognisable colour
     * (e.g. "the sage dot") that works on both light and dark canvases.
     * Matches the corresponding hue in `STATUS_PALETTE.dot` where the
     * run-status maps onto an item-status (in_progress ↔ in_progress,
     * completed ↔ done, etc.).
     */
    dot: string;
}

type RunStatusPaletteKey = RunStatus | 'running' | 'failed';

export const RUN_STATUS_PALETTE: Record<RunStatusPaletteKey, RunStatusPaletteEntry> = {
    queued: { bg: '#EEF1F4', fg: '#727A87', dot: '#94A0AE' }, // stone
    in_progress: { bg: '#E5E8F4', fg: '#5E66B5', dot: '#7B83D4' }, // periwinkle
    running: { bg: '#E5E8F4', fg: '#5E66B5', dot: '#7B83D4' }, // alias of in_progress
    completed: { bg: '#DDECE2', fg: '#4A7C5C', dot: '#6EA67E' }, // sage
    error: { bg: '#F9DCD8', fg: '#A4504A', dot: '#D08580' }, // dusty rose
    failed: { bg: '#F9DCD8', fg: '#A4504A', dot: '#D08580' }, // alias of error
    cancelled: { bg: '#FBE5C9', fg: '#A06A30', dot: '#D4914A' }, // apricot
    setup_failed: { bg: '#F9DCD8', fg: '#A4504A', dot: '#D08580' }, // alias of error
};

export const DEFAULT_RUN_STATUS_PALETTE_ENTRY: RunStatusPaletteEntry = {
    bg: '#EEF1F4',
    fg: '#727A87',
    dot: '#94A0AE',
};

export function runStatusPaletteEntry(status: string): RunStatusPaletteEntry {
    return (
        (RUN_STATUS_PALETTE as Record<string, RunStatusPaletteEntry>)[status] ??
        DEFAULT_RUN_STATUS_PALETTE_ENTRY
    );
}
