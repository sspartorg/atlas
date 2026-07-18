import { describe, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { PriorityPickerPopover } from './PriorityPickerPopover.js';

describe('PriorityPickerPopover', () => {
    it('mounts in closed state', () => {
        renderWithProviders(
            <PriorityPickerPopover
                anchorEl={null}
                open={false}
                onClose={vi.fn()}
                current="normal"
                onPick={vi.fn()}
            />,
        );
    });
});
