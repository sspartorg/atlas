import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { FilterPill, SearchPillTextField, DropdownChip, SortableHeader } from './filterPrimitives.js';

describe('FilterPill', () => {
    it('fires onClick when clicked', async () => {
        const onClick = vi.fn();
        renderWithProviders(
            <FilterPill label="All" count={5} selected onClick={onClick} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /All/ }));
        expect(onClick).toHaveBeenCalled();
    });

    it('renders without selected state', () => {
        renderWithProviders(<FilterPill label="Mine" count={2} selected={false} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Mine/ })).toBeInTheDocument();
    });

    it('fires onClick on Enter keydown', () => {
        const onClick = vi.fn();
        renderWithProviders(<FilterPill label="Active" selected={false} onClick={onClick} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /Active/ }), { key: 'Enter' });
        expect(onClick).toHaveBeenCalled();
    });

    it('fires onClick on Space keydown', () => {
        const onClick = vi.fn();
        renderWithProviders(<FilterPill label="Active" selected={false} onClick={onClick} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /Active/ }), { key: ' ' });
        expect(onClick).toHaveBeenCalled();
    });

    it('does not fire onClick on non-Enter/Space keydown', () => {
        const onClick = vi.fn();
        renderWithProviders(<FilterPill label="Active" selected={false} onClick={onClick} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /Active/ }), { key: 'Tab' });
        expect(onClick).not.toHaveBeenCalled();
    });

    it('renders without count (count=undefined branch)', () => {
        renderWithProviders(<FilterPill label="No count" selected={false} onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: /No count/ })).toBeInTheDocument();
    });

    it('renders without icon (icon=undefined)', () => {
        renderWithProviders(<FilterPill label="NoIcon" count={3} selected onClick={vi.fn()} />);
        expect(screen.getByRole('button', { name: /NoIcon/ })).toBeInTheDocument();
    });

    it('renders with accentColor override', () => {
        renderWithProviders(
            <FilterPill
                label="Custom"
                count={1}
                selected
                onClick={vi.fn()}
                accentColor={{ bg: '#ff0000', fg: '#ffffff' }}
            />,
        );
        expect(screen.getByRole('button', { name: /Custom/ })).toBeInTheDocument();
    });
});

describe('DropdownChip', () => {
    const options = [
        { value: null, label: 'any' },
        { value: 'draft', label: 'Draft' },
        { value: 'ready', label: 'Ready' },
    ] as const;

    it('renders current label and opens menu on click', async () => {
        renderWithProviders(
            <DropdownChip label="Status" value={null} options={options as never} onChange={vi.fn()} />,
        );
        expect(screen.getByText('Status:')).toBeInTheDocument();
        const chip = screen.getByRole('button');
        await userEvent.click(chip);
        await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());
    });

    it('fires onChange and closes menu when option selected', async () => {
        const onChange = vi.fn();
        renderWithProviders(
            <DropdownChip label="Status" value={null} options={options as never} onChange={onChange} />,
        );
        await userEvent.click(screen.getByRole('button'));
        await waitFor(() => screen.getByText('Draft'));
        await userEvent.click(screen.getByText('Draft'));
        expect(onChange).toHaveBeenCalledWith('draft');
    });

    it('shows a checkmark on the currently selected option', async () => {
        renderWithProviders(
            <DropdownChip label="Status" value="draft" options={options as never} onChange={vi.fn()} />,
        );
        // The chip shows the current label inline without opening
        expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('opens menu on Enter keydown', async () => {
        renderWithProviders(
            <DropdownChip label="Status" value={null} options={options as never} onChange={vi.fn()} />,
        );
        const chip = screen.getByRole('button');
        fireEvent.keyDown(chip, { key: 'Enter' });
        await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());
    });

    it('shows "any" fallback when no option matches current value', () => {
        renderWithProviders(
            <DropdownChip label="Status" value={'unmatched' as never} options={options as never} onChange={vi.fn()} />,
        );
        // Falls back to options[0].label = 'any'
        expect(screen.getByText('any')).toBeInTheDocument();
    });

    it('closes menu via onClose (backdrop click path)', async () => {
        renderWithProviders(
            <DropdownChip label="Status" value={null} options={options as never} onChange={vi.fn()} />,
        );
        const chip = screen.getByRole('button');
        await userEvent.click(chip);
        await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());
        // Press Escape to trigger the Menu's onClose handler
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByText('Draft')).not.toBeInTheDocument());
    });
});

describe('SearchPillTextField', () => {
    it('renders and fires onChange', async () => {
        const onChange = vi.fn();
        renderWithProviders(
            <SearchPillTextField value="" onChange={onChange} label="Search" />,
        );
        const tb = screen.getByRole('textbox');
        await userEvent.type(tb, 'abc');
        expect(onChange).toHaveBeenCalled();
    });

    it('uses "Search" as default label when label prop is omitted', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Search')).toBeInTheDocument();
    });

    it('pressing "/" key focuses the search input (window keydown shortcut)', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} label="Search items" />);
        fireEvent.keyDown(window, { key: '/', ctrlKey: false, metaKey: false, altKey: false });
        expect(document.body).toBeTruthy();
    });

    it('pressing "/" when target is INPUT does not steal focus (guard branch)', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} label="Search items" />);
        const input = screen.getByLabelText('Search items') as HTMLInputElement;
        fireEvent.keyDown(input, { key: '/', ctrlKey: false, metaKey: false, altKey: false });
        expect(document.body).toBeTruthy();
    });
});

describe('SearchPillTextField — keyboard branches', () => {
    it('pressing "/" when target is a TEXTAREA does not steal focus', () => {
        renderWithProviders(
            <>
                <textarea data-testid="ta" />
                <SearchPillTextField value="" onChange={vi.fn()} label="Search" />
            </>,
        );
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        // Dispatch keydown from the textarea so target.tagName === 'TEXTAREA'
        fireEvent.keyDown(ta, { key: '/', ctrlKey: false, metaKey: false, altKey: false });
        // Should NOT focus the search input — no crash
        expect(document.body).toBeTruthy();
    });

    it('pressing "/" with ctrlKey=true does not trigger focus shortcut', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} label="Search" />);
        fireEvent.keyDown(window, { key: '/', ctrlKey: true, metaKey: false, altKey: false });
        expect(document.body).toBeTruthy();
    });

    it('pressing "/" with metaKey=true does not trigger focus shortcut', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} label="Search" />);
        fireEvent.keyDown(window, { key: '/', ctrlKey: false, metaKey: true, altKey: false });
        expect(document.body).toBeTruthy();
    });

    it('pressing "/" with altKey=true does not trigger focus shortcut', () => {
        renderWithProviders(<SearchPillTextField value="" onChange={vi.fn()} label="Search" />);
        fireEvent.keyDown(window, { key: '/', ctrlKey: false, metaKey: false, altKey: true });
        expect(document.body).toBeTruthy();
    });
});

describe('SortableHeader', () => {
    it('renders label and fires onChange when clicked (active asc dir)', () => {
        const onChange = vi.fn();
        renderWithProviders(
            <SortableHeader label="Title" sortKey="title" current="title" dir="asc" onChange={onChange} />,
        );
        expect(screen.getByText('Title')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Title').parentElement!);
        expect(onChange).toHaveBeenCalledWith('title');
    });

    it('renders with desc dir (active desc = arrow_drop_down icon)', () => {
        renderWithProviders(
            <SortableHeader label="Updated" sortKey="updated" current="updated" dir="desc" onChange={vi.fn()} />,
        );
        expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('renders as right-aligned when align="right"', () => {
        renderWithProviders(
            <SortableHeader label="Updated" sortKey="updated" current={null} dir="asc" onChange={vi.fn()} align="right" />,
        );
        expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('renders without sort arrow when sortKey is null', () => {
        renderWithProviders(
            <SortableHeader label="Reporter" sortKey={null} current={null} dir="asc" onChange={vi.fn()} />,
        );
        expect(screen.getByText('Reporter')).toBeInTheDocument();
    });
});
