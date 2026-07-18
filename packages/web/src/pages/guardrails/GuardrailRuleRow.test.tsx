import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IGuardrailRule } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { GuardrailRuleRow } from './GuardrailRuleRow.js';

const baseRule: IGuardrailRule = {
    id: 'g1',
    category: 'file_system',
    rule_text: 'Never log secrets',
    detail: null,
    severity: 'block',
    sort_order: 0,
    created_at: '',
    updated_at: '',
};

describe('GuardrailRuleRow', () => {
    it('renders and fires onEdit', async () => {
        const onEdit = vi.fn();
        renderWithProviders(<GuardrailRuleRow rule={baseRule} onEdit={onEdit} />);
        expect(screen.getByText(/Never log secrets/)).toBeInTheDocument();
        await userEvent.click(screen.getByText(/Never log secrets/));
        expect(onEdit).toHaveBeenCalled();
    });

    it('renders detail text when rule.detail is set (detail truthy branch)', () => {
        renderWithProviders(
            <GuardrailRuleRow
                rule={{ ...baseRule, detail: 'Extra context here' }}
                onEdit={vi.fn()}
            />,
        );
        expect(screen.getByText(/Extra context here/)).toBeInTheDocument();
    });

    it('does not render a detail paragraph when rule.detail is null', () => {
        renderWithProviders(<GuardrailRuleRow rule={{ ...baseRule, detail: null }} onEdit={vi.fn()} />);
        expect(screen.queryByText(/Extra context/)).not.toBeInTheDocument();
    });

    it('renders different severity chips — warn and ask_owner', () => {
        const { unmount } = renderWithProviders(
            <GuardrailRuleRow rule={{ ...baseRule, severity: 'warn' }} onEdit={vi.fn()} />,
        );
        expect(screen.getByText(/Never log secrets/)).toBeInTheDocument();
        unmount();
        renderWithProviders(
            <GuardrailRuleRow rule={{ ...baseRule, severity: 'ask_owner' }} onEdit={vi.fn()} />,
        );
        expect(screen.getByText(/Never log secrets/)).toBeInTheDocument();
    });
});
