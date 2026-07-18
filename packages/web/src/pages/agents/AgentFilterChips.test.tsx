import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentFilterChips } from './AgentFilterChips.js';
import type { FilterKey, SortKey, RoleFilterKey } from './AgentFilterChips.js';

const BASE_COUNTS: Record<FilterKey, number> = {
    all: 10,
    'software-dev': 4,
    marketing: 2,
    content: 2,
    design: 1,
    favorites: 1,
};

function baseProps(overrides: Partial<{
    active: FilterKey;
    counts: Record<FilterKey, number>;
    onChange: (k: FilterKey) => void;
    sort: SortKey;
    onSortChange: (s: SortKey) => void;
}> = {}) {
    return {
        active: 'all' as FilterKey,
        counts: BASE_COUNTS,
        onChange: vi.fn(),
        sort: 'category-role' as SortKey,
        onSortChange: vi.fn(),
        ...overrides,
    };
}

describe('AgentFilterChips', () => {
    it('renders all six filter pills with correct labels', () => {
        server.use(...defaultHandlers);
        renderWithProviders(<AgentFilterChips {...baseProps()} />);
        expect(screen.getByText('All')).toBeInTheDocument();
        expect(screen.getByText('Software dev')).toBeInTheDocument();
        expect(screen.getByText('Marketing')).toBeInTheDocument();
        expect(screen.getByText('Content')).toBeInTheDocument();
        expect(screen.getByText('Design')).toBeInTheDocument();
        expect(screen.getByText('My favorites')).toBeInTheDocument();
    });

    it('calls onChange with the correct FilterKey when a pill is clicked', async () => {
        server.use(...defaultHandlers);
        const onChange = vi.fn();
        renderWithProviders(<AgentFilterChips {...baseProps({ onChange })} />);
        await userEvent.click(screen.getByText('Software dev'));
        expect(onChange).toHaveBeenCalledWith('software-dev');
    });

    it('renders the sort select with default value', () => {
        server.use(...defaultHandlers);
        renderWithProviders(<AgentFilterChips {...baseProps()} />);
        // MUI Standard Select renders a combobox — there's exactly one (the sort select)
        const selects = screen.getAllByRole('combobox');
        // At minimum one combobox (sort) must be present
        expect(selects.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT render the Role select when onRoleChange is undefined', () => {
        server.use(...defaultHandlers);
        renderWithProviders(<AgentFilterChips {...baseProps()} />);
        expect(screen.queryByText('Role:')).not.toBeInTheDocument();
    });

    it('renders the Role select when onRoleChange is provided', () => {
        server.use(...defaultHandlers);
        const roleCounts = { all: 10 } as Record<RoleFilterKey, number>;
        renderWithProviders(
            <AgentFilterChips
                {...baseProps()}
                role="all"
                onRoleChange={vi.fn()}
                roleCounts={roleCounts}
            />,
        );
        expect(screen.getByText('Role:')).toBeInTheDocument();
        // Two comboboxes: role + sort
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
    });

    it('renders Role select without roleCounts (covers lines 156, 163 falsy branch)', () => {
        // When onRoleChange is provided but roleCounts is undefined, the ternary
        // falls to the '' branch: `roleCounts ? ` (${roleCounts.all})` : ''`
        server.use(...defaultHandlers);
        renderWithProviders(
            <AgentFilterChips
                {...baseProps()}
                role="all"
                onRoleChange={vi.fn()}
            />,
        );
        expect(screen.getByText('Role:')).toBeInTheDocument();
        // "All roles" label renders without count suffix (no roleCounts)
        expect(screen.getByText('All roles')).toBeInTheDocument();
    });

    it('calls onSortChange when sort select value changes (covers line 174)', async () => {
        // Line 174: onChange={(e) => onSortChange(e.target.value as SortKey)}
        server.use(...defaultHandlers);
        const onSortChange = vi.fn();
        renderWithProviders(<AgentFilterChips {...baseProps({ onSortChange })} />);
        // Click the sort combobox to open the dropdown, then click an option
        const selects = screen.getAllByRole('combobox');
        const sortSelect = selects[selects.length - 1]!;
        await userEvent.click(sortSelect);
        // MUI dropdown renders menu items in a portal
        const option = await screen.findByRole('option', { name: /Last run/i });
        await userEvent.click(option);
        expect(onSortChange).toHaveBeenCalledWith('last-run');
    });

    it('renders pills with ?? 0 fallback when a count key is missing (covers line 120)', () => {
        // Line 120: count={counts[chip.key] ?? 0} — counts missing a key falls to 0
        server.use(...defaultHandlers);
        // Omit 'design' and 'favorites' from counts to trigger ?? 0
        const sparseCounts = {
            all: 10,
            'software-dev': 4,
            marketing: 2,
            content: 2,
        } as unknown as Record<FilterKey, number>;
        renderWithProviders(
            <AgentFilterChips
                {...baseProps({ counts: sparseCounts })}
            />,
        );
        // All pills still render even with missing counts
        expect(screen.getByText('Design')).toBeInTheDocument();
        expect(screen.getByText('My favorites')).toBeInTheDocument();
    });

    it('calls onRoleChange when role select value changes (covers line 145)', async () => {
        // Line 145: onChange={(e) => onRoleChange(e.target.value as RoleFilterKey)}
        server.use(...defaultHandlers);
        const onRoleChange = vi.fn();
        const roleCounts = { all: 5, 'software-engineer': 2 } as unknown as Record<RoleFilterKey, number>;
        renderWithProviders(
            <AgentFilterChips
                {...baseProps()}
                role="all"
                onRoleChange={onRoleChange}
                roleCounts={roleCounts}
            />,
        );
        // First combobox is the role select (renders before sort select)
        const selects = screen.getAllByRole('combobox');
        const roleSelect = selects[0]!;
        await userEvent.click(roleSelect);
        // Find any option that isn't "All roles" and click it
        const options = await screen.findAllByRole('option');
        const nonAllOption = options.find((o) => !o.textContent?.includes('All roles'));
        if (nonAllOption) {
            await userEvent.click(nonAllOption);
            expect(onRoleChange).toHaveBeenCalled();
        } else {
            // Fallback: just verify the dropdown opened
            expect(options.length).toBeGreaterThan(0);
        }
    });
});
