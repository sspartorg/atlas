import { describe, expect, it } from 'vitest';
import { runStatusPaletteEntry, RUN_STATUS_PALETTE, DEFAULT_RUN_STATUS_PALETTE_ENTRY } from './runStatusPalette.js';

describe('runStatusPaletteEntry', () => {
    it('returns the correct entry for "queued"', () => {
        const entry = runStatusPaletteEntry('queued');
        expect(entry).toEqual(RUN_STATUS_PALETTE.queued);
        expect(entry.bg).toBeTruthy();
        expect(entry.fg).toBeTruthy();
        expect(entry.dot).toBeTruthy();
    });

    it('returns the correct entry for "in_progress"', () => {
        const entry = runStatusPaletteEntry('in_progress');
        expect(entry).toEqual(RUN_STATUS_PALETTE.in_progress);
    });

    it('returns the correct entry for "completed"', () => {
        const entry = runStatusPaletteEntry('completed');
        expect(entry).toEqual(RUN_STATUS_PALETTE.completed);
    });

    it('returns the correct entry for "error"', () => {
        const entry = runStatusPaletteEntry('error');
        expect(entry).toEqual(RUN_STATUS_PALETTE.error);
    });

    it('returns the correct entry for "cancelled"', () => {
        const entry = runStatusPaletteEntry('cancelled');
        expect(entry).toEqual(RUN_STATUS_PALETTE.cancelled);
    });

    it('returns the correct entry for "setup_failed"', () => {
        const entry = runStatusPaletteEntry('setup_failed');
        expect(entry).toEqual(RUN_STATUS_PALETTE.setup_failed);
    });

    it('returns the "running" alias (same as in_progress)', () => {
        const running = runStatusPaletteEntry('running');
        const inProgress = runStatusPaletteEntry('in_progress');
        expect(running).toEqual(inProgress);
    });

    it('returns the "failed" alias (same as error)', () => {
        const failed = runStatusPaletteEntry('failed');
        const error = runStatusPaletteEntry('error');
        expect(failed).toEqual(error);
    });

    it('returns the default entry for unknown status', () => {
        const entry = runStatusPaletteEntry('unknown-status-xyz');
        expect(entry).toEqual(DEFAULT_RUN_STATUS_PALETTE_ENTRY);
    });

    it('default entry has bg, fg, dot properties', () => {
        expect(DEFAULT_RUN_STATUS_PALETTE_ENTRY).toHaveProperty('bg');
        expect(DEFAULT_RUN_STATUS_PALETTE_ENTRY).toHaveProperty('fg');
        expect(DEFAULT_RUN_STATUS_PALETTE_ENTRY).toHaveProperty('dot');
    });
});
