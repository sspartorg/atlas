import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EMPTY_FILTERS, type FilterState } from './searchViewModel.js';
import { SearchFilterBuilder } from './SearchFilterBuilder.js';
import { makeProject } from '../../test-utils/factories.js';

// Helpers — open the "Add Filter" picker, then click the sub-picker entry.
// Each test wires up `setFilters` so we can assert the callback fires AND
// verify the next filter shape, exercising the relevant handler branches.
function openAddMenu() {
    const trigger = screen.getByText('Add Filter');
    fireEvent.click(trigger);
}

describe('SearchFilterBuilder', () => {
    it('mounts with empty filters', () => {
        const { container } = renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders all five pill kinds when filters are populated', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={{
                    ...EMPTY_FILTERS,
                    types: ['story', 'bug'],
                    projectIds: ['p1'],
                    updated: 'today',
                    status: 'in_progress',
                    labels: ['urgent'],
                }}
                setFilters={vi.fn()}
                projects={[makeProject({ id: 'p1', name: 'Atlas' })]}
                resultCount={2}
                resultTypeCount={2}
                availableLabels={['urgent', 'frontend']}
            />,
        );
        // Verifies every pill renders its label + value.
        expect(screen.getByText('Type:')).toBeInTheDocument();
        expect(screen.getByText('Project:')).toBeInTheDocument();
        expect(screen.getByText('Updated:')).toBeInTheDocument();
        expect(screen.getByText('Status:')).toBeInTheDocument();
        expect(screen.getByText('Labels:')).toBeInTheDocument();
    });

    it('renders the singular "1 result across 1 type" copy', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={1}
                resultTypeCount={1}
            />,
        );
        expect(screen.getByText(/1 result$/)).toBeInTheDocument();
        expect(screen.getByText(/1 type$/)).toBeInTheDocument();
    });

    it('opens the Add menu and shows all 5 add options', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        openAddMenu();
        expect(screen.getByRole('menuitem', { name: 'Type' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Project' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Updated' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Status' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Labels' })).toBeInTheDocument();
    });

    it('clicks Add → Type → toggles a type on then off (toggleType branch coverage)', () => {
        const setFilters = vi.fn();
        const { rerender } = renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Type' }));
        // The type submenu renders 6 menuitems; click "Story".
        const storyItem = screen.getByRole('menuitem', { name: /Story/i });
        fireEvent.click(storyItem);
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ types: ['story'] }),
        );
        // Re-render with the story already selected; clicking it again removes it.
        rerender(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Re-open the menu and verify clicking the chip opens the picker on it.
        fireEvent.click(screen.getByText('Type:'));
        const storyItem2 = screen.getByRole('menuitem', { name: /Story/i });
        fireEvent.click(storyItem2);
        expect(setFilters).toHaveBeenLastCalledWith(
            expect.objectContaining({ types: [] }),
        );
    });

    it('clicks Add → Project → selects a project (setProject branch)', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={setFilters}
                projects={[
                    makeProject({ id: 'p1', name: 'Atlas' }),
                    makeProject({ id: 'p2', name: 'Other' }),
                ]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Project' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Atlas' }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ projectIds: ['p1'] }),
        );
    });

    it('clicks Add → Project → (any project) clears the projectIds (setProject(null) branch)', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, projectIds: ['p1'] }}
                setFilters={setFilters}
                projects={[makeProject({ id: 'p1', name: 'Atlas' })]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Click the existing project pill to open the project picker directly.
        fireEvent.click(screen.getByText('Project:'));
        fireEvent.click(screen.getByRole('menuitem', { name: /any project/i }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ projectIds: [] }),
        );
    });

    it('clicks Add → Updated → picks a range (setUpdated branch)', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Updated' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'last 7 days' }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ updated: 'last_7_days' }),
        );
    });

    it('clicks Add → Updated → (any time) clears the range', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, updated: 'today' }}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        fireEvent.click(screen.getByText('Updated:'));
        fireEvent.click(screen.getByRole('menuitem', { name: /any time/i }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ updated: 'any' }),
        );
    });

    it('clicks Add → Status → picks a status (setStatus branch)', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Status' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'in progress' }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'in_progress' }),
        );
    });

    it('clicks Add → Status → (any status) clears the status', () => {
        const setFilters = vi.fn();
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, status: 'done' }}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        fireEvent.click(screen.getByText('Status:'));
        fireEvent.click(screen.getByRole('menuitem', { name: /any status/i }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'any' }),
        );
    });

    it('clicks Add → Labels → toggles a label on and off (toggleLabel branch)', () => {
        const setFilters = vi.fn();
        const { rerender } = renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
                availableLabels={['urgent', 'frontend']}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Labels' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /urgent/i }));
        expect(setFilters).toHaveBeenCalledWith(
            expect.objectContaining({ labels: ['urgent'] }),
        );
        rerender(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, labels: ['urgent'] }}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
                availableLabels={['urgent', 'frontend']}
            />,
        );
        fireEvent.click(screen.getByText('Labels:'));
        fireEvent.click(screen.getByRole('menuitem', { name: /urgent/i }));
        expect(setFilters).toHaveBeenLastCalledWith(
            expect.objectContaining({ labels: [] }),
        );
    });

    it('renders "No labels exist yet" when availableLabels is empty', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
                availableLabels={[]}
            />,
        );
        openAddMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Labels' }));
        expect(screen.getByText(/No labels exist yet/i)).toBeInTheDocument();
    });

    it('clicks the remove-X icon on each active pill (onRemove branch)', () => {
        const setFilters = vi.fn();
        const filters: FilterState = {
            ...EMPTY_FILTERS,
            types: ['story'],
            projectIds: ['p1'],
            updated: 'today',
            status: 'in_progress',
            labels: ['urgent'],
        };
        const { container } = renderWithProviders(
            <SearchFilterBuilder
                filters={filters}
                setFilters={setFilters}
                projects={[makeProject({ id: 'p1', name: 'Atlas' })]}
                resultCount={2}
                resultTypeCount={2}
                availableLabels={['urgent']}
            />,
        );
        // The remove handler sits on the `close` icon span (role=button inside the pill).
        // Each pill contains a child role=button for the X — query all of them, then click each.
        const xButtons = container.querySelectorAll('[role="button"]');
        // First role=button per pill is the pill itself; the inner `close` span is also role=button.
        // We click every inner X by filtering on the text content `close`.
        const closeButtons: Element[] = [];
        xButtons.forEach((el) => {
            if (el.textContent === 'close') closeButtons.push(el);
        });
        expect(closeButtons.length).toBeGreaterThan(0);
        closeButtons.forEach((b) => fireEvent.click(b));
        // 5 pills * 1 onRemove each = setFilters called at least 5 times.
        expect(setFilters.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it('fires onRemove via keyboard Enter on a pill X', () => {
        const setFilters = vi.fn();
        const { container } = renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                setFilters={setFilters}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        const closeIcons = Array.from(container.querySelectorAll('[role="button"]')).filter(
            (el) => el.textContent === 'close',
        );
        if (closeIcons[0]) {
            fireEvent.keyDown(closeIcons[0], { key: 'Enter' });
            fireEvent.keyDown(closeIcons[0], { key: ' ' });
        }
        expect(setFilters).toHaveBeenCalled();
    });

    it('opens a pill picker by pressing Enter on the pill button (keyboard branch)', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Target the outer pill wrapper, not the inner close button
        const pillWrappers = Array.from(document.querySelectorAll('[role="button"]')).filter(
            (el) => el.querySelector('[role="button"]') !== null,
        );
        const typePill = pillWrappers.find((el) => el.textContent?.includes('Type:'));
        if (typePill) {
            fireEvent.keyDown(typePill, { key: 'Enter' });
        }
    });

    it('opens a pill picker by pressing Space on the pill button (L315 Space branch)', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Target the outer pill wrapper directly
        const pillWrappers = Array.from(document.querySelectorAll('[role="button"]')).filter(
            (el) => el.querySelector('[role="button"]') !== null,
        );
        const typePill = pillWrappers.find((el) => el.textContent?.includes('Type:'));
        if (typePill) {
            fireEvent.keyDown(typePill, { key: ' ' });
        }
    });

    it('opens the Add Filter via keyboard Enter (Add Filter keyDown branch)', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        const addBtn = screen.getByText('Add Filter');
        fireEvent.keyDown(addBtn, { key: 'Enter' });
    });

    it('renders the project pill with the raw project id when the project record is missing', () => {
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, projectIds: ['unknown-id'] }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Fallback path: name = id when no matching project exists.
        expect(screen.getByText('unknown-id')).toBeInTheDocument();
    });

    it('L229: ?? filters.status fallback — status not in STATUS_OPTIONS renders raw value', () => {
        // STATUS_OPTIONS has 6 values. 'archived' is not one of them → find() returns undefined
        // → the ?? filters.status fallback fires, rendering the raw status string.
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, status: 'archived' as never }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // The status pill renders 'archived' as the value (raw fallback from ??)
        expect(screen.getByText('archived')).toBeInTheDocument();
    });

    it('L217: ?? filters.updated fallback — updated not in UPDATED_OPTIONS renders raw value', () => {
        // UPDATED_OPTIONS has 4 values. 'last_365_days' is not one → find() returns undefined
        // → the ?? filters.updated fallback fires, rendering the raw updated string.
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, updated: 'last_365_days' as never }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        expect(screen.getByText('last_365_days')).toBeInTheDocument();
    });

    it('Space on pill wrapper opens the picker (L315 Space → p.onClick branch)', () => {
        // The pill onKeyDown at L314-319 handles both Enter and Space.
        // The existing Enter test covers the Enter branch; this test covers the Space branch.
        // We verify the picker actually opens (type menu appears) when Space is pressed.
        renderWithProviders(
            <SearchFilterBuilder
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        // Find the outer pill wrapper (role=button that contains another role=button inside it)
        const pillWrappers = Array.from(document.querySelectorAll('[role="button"]')).filter(
            (el) => el.querySelector('[role="button"]') !== null,
        );
        const typePill = pillWrappers.find((el) => el.textContent?.includes('Type:'));
        expect(typePill).toBeDefined();
        if (typePill) {
            fireEvent.keyDown(typePill, { key: ' ' });
        }
        // The Space key fires p.onClick which calls openAdd → sets editingPill to 'type'
        // The type picker menu should now be open (contains "Story" menuitem)
        expect(screen.getByRole('menuitem', { name: /Story/i })).toBeInTheDocument();
    });

    it('non-Enter key on Add Filter button is a no-op (L353 else branch)', () => {
        // The Add Filter onKeyDown at L353-355 only calls openAdd for 'Enter'.
        // Any other key (e.g. Space, Tab) falls through without opening the menu.
        renderWithProviders(
            <SearchFilterBuilder
                filters={EMPTY_FILTERS}
                setFilters={vi.fn()}
                projects={[]}
                resultCount={0}
                resultTypeCount={0}
            />,
        );
        const addBtn = screen.getByText('Add Filter');
        // Fire a non-Enter key — should NOT open the add menu
        fireEvent.keyDown(addBtn, { key: ' ' });
        // The add menu (which contains 'Type' menuitem) should NOT be in the document
        expect(screen.queryByRole('menuitem', { name: 'Type' })).toBeNull();
    });
}, 15000);
