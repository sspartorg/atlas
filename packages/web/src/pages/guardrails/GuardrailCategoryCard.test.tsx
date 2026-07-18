import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { IGuardrailRule } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { GuardrailCategoryCard } from './GuardrailCategoryCard.js';

const baseRule: IGuardrailRule = {
    id: 'r1',
    category: 'file_system',
    rule_text: 'Never delete .env',
    detail: null,
    severity: 'block',
    sort_order: 0,
    created_at: '',
    updated_at: '',
};

describe('GuardrailCategoryCard', () => {
    it('renders empty-state when no rules (0 rules branch)', () => {
        renderWithProviders(
            <GuardrailCategoryCard
                category="file_system"
                rules={[]}
                onAdd={vi.fn()}
                onEdit={vi.fn()}
            />,
        );
        expect(screen.getByText(/No rules in this category yet/i)).toBeInTheDocument();
        expect(screen.getByText(/0 rules/i)).toBeInTheDocument();
    });

    it('shows singular "1 rule" label when exactly 1 rule', () => {
        renderWithProviders(
            <GuardrailCategoryCard
                category="file_system"
                rules={[baseRule]}
                onAdd={vi.fn()}
                onEdit={vi.fn()}
            />,
        );
        expect(screen.getByText(/1 rule$/i)).toBeInTheDocument();
    });

    it('renders GuardrailRuleRow for each rule (rules.length>0 branch)', () => {
        renderWithProviders(
            <GuardrailCategoryCard
                category="file_system"
                rules={[baseRule, { ...baseRule, id: 'r2', rule_text: 'Second rule' }]}
                onAdd={vi.fn()}
                onEdit={vi.fn()}
            />,
        );
        expect(screen.getByText('Never delete .env')).toBeInTheDocument();
        expect(screen.getByText('Second rule')).toBeInTheDocument();
        expect(screen.getByText(/2 rules/i)).toBeInTheDocument();
    });

    it('calls onAdd when the Add rule button is clicked', () => {
        const onAdd = vi.fn();
        renderWithProviders(
            <GuardrailCategoryCard
                category="file_system"
                rules={[]}
                onAdd={onAdd}
                onEdit={vi.fn()}
            />,
        );
        const addBtn = screen.getByRole('button', { name: /Add rule/i });
        fireEvent.click(addBtn);
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('calls onEdit when a rule row is clicked', () => {
        const onEdit = vi.fn();
        renderWithProviders(
            <GuardrailCategoryCard
                category="file_system"
                rules={[baseRule]}
                onAdd={vi.fn()}
                onEdit={onEdit}
            />,
        );
        const ruleRow = screen.getByRole('button', { name: /Never delete/i });
        fireEvent.click(ruleRow);
        expect(onEdit).toHaveBeenCalledWith(baseRule);
    });

    it('renders for different categories (side_effects_network category)', () => {
        renderWithProviders(
            <GuardrailCategoryCard
                category="side_effects_network"
                rules={[]}
                onAdd={vi.fn()}
                onEdit={vi.fn()}
            />,
        );
        expect(screen.getByText(/0 rules/i)).toBeInTheDocument();
    });
});
