import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EMPTY_FILTERS } from './searchViewModel.js';
import { SearchEmptyState } from './SearchEmptyState.js';

describe('SearchEmptyState', () => {
    it('renders and fires Create CTA', async () => {
        const onCreateType = vi.fn();
        renderWithProviders(
            <SearchEmptyState
                filters={EMPTY_FILTERS}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={onCreateType}
            />,
        );
        expect(screen.getByText(/No Items Match/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Create/ }));
        expect(onCreateType).toHaveBeenCalled();
    });

    it('renders Drop status and Drop project when active', () => {
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, status: 'ready', projectIds: ['p1'] }}
                queryText="status = ready"
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /Drop the Status/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Different Project/ })).toBeInTheDocument();
    });

    it('shows queryText code block when queryText is provided (supplemental truthy branch)', () => {
        renderWithProviders(
            <SearchEmptyState
                filters={EMPTY_FILTERS}
                queryText="type = story"
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        expect(screen.getByText('type = story')).toBeInTheDocument();
    });

    it('createLabel is "Sub-task" when first type is sub_task', () => {
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, types: ['sub_task'] }}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        // Button label uses createLabel which is "Sub-task" when type=sub_task
        expect(screen.getByRole('button', { name: /Create a Sub-task/ })).toBeInTheDocument();
    });

    it('createLabel uses capitalized type name for story (else branch)', () => {
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, types: ['story'] }}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        // "story" -> createLabel = "Story" (capitalize first char)
        expect(screen.getByRole('button', { name: /Create a Story/ })).toBeInTheDocument();
    });

    it('fires onDropStatus when Drop status button is clicked', () => {
        const onDropStatus = vi.fn();
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, status: 'in_progress' }}
                queryText={null}
                onDropStatus={onDropStatus}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Drop the Status/ }));
        expect(onDropStatus).toHaveBeenCalledOnce();
    });

    it('fires onDropProject when Try Different Project button is clicked', () => {
        const onDropProject = vi.fn();
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, projectIds: ['proj-abc'] }}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={onDropProject}
                onCreateType={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Different Project/ }));
        expect(onDropProject).toHaveBeenCalledOnce();
    });

    it('L31 ?? "" branch — createLabel falls back to empty string prefix when createType is empty', () => {
        // createType[0]?.toUpperCase() returns undefined when createType is '', so ?? '' fires.
        // filters.types[0] = '' (cast as never) → createType = '' → label = '' + '' = ''
        // The button will read "Create a " (no label suffix after the space).
        renderWithProviders(
            <SearchEmptyState
                filters={{ ...EMPTY_FILTERS, types: ['' as never] }}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        // createLabel = (''[0]?.toUpperCase() ?? '') + ''.slice(1) = '' + '' = ''
        // Button text becomes "Create a " — verify it renders without crashing
        expect(screen.getByRole('button', { name: /Create a/ })).toBeInTheDocument();
    });

    it('supplemental is undefined (falsy) when queryText is null (L47 false branch)', () => {
        // queryText=null → supplemental=undefined → no code block rendered
        renderWithProviders(
            <SearchEmptyState
                filters={EMPTY_FILTERS}
                queryText={null}
                onDropStatus={vi.fn()}
                onDropProject={vi.fn()}
                onCreateType={vi.fn()}
            />,
        );
        // The queryText code block should NOT be present
        expect(screen.queryByRole('code')).toBeNull();
    });
});
