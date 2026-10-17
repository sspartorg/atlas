import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { SelectableCard } from './SchedulePresetFields.js';

describe('SelectableCard', () => {
    it('is a real button: Tab reaches it, Enter and Space press it, aria-pressed reflects the pick', async () => {
        const onClick = vi.fn();
        renderWithProviders(
            <>
                <SelectableCard title="Daily" sub="at 09:00" selected={false} onClick={onClick} />
                <SelectableCard title="Weekly" sub="once a week" selected onClick={vi.fn()} />
            </>
        );
        const daily = screen.getByRole('button', { name: /Daily/ });
        expect(daily).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /Weekly/ })).toHaveAttribute('aria-pressed', 'true');

        await userEvent.tab();
        expect(daily).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onClick).toHaveBeenCalledTimes(2);
    });
});
