import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { CloneStatus } from '@atlas/shared';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { CloneStatusChip } from './CloneStatusChip.js';

describe('CloneStatusChip', () => {
    it.each([
        ['pending', 'Pending'],
        ['cloning', 'Cloning'],
        ['ready', 'Ready'],
        ['error', 'Error'],
    ])('renders the canonical label for %s', (status, label) => {
        renderWithProviders(<CloneStatusChip status={status as CloneStatus} />);
        expect(screen.getByLabelText(label)).toBeInTheDocument();
    });

    // The inline map this replaced coloured `ready` with ATLAS_PALETTE.green and
    // `cloning` with brandBlue — both #4F46E5 in Mercury, so a finished clone
    // looked exactly like one still running.
    it('gives ready and cloning different colours', () => {
        const { unmount } = renderWithProviders(<CloneStatusChip status="ready" />);
        const ready = getComputedStyle(screen.getByLabelText('Ready')).color;
        unmount();

        renderWithProviders(<CloneStatusChip status="cloning" />);
        const cloning = getComputedStyle(screen.getByLabelText('Cloning')).color;

        expect(ready).not.toBe(cloning);
    });
});
