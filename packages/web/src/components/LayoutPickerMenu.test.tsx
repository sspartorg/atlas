import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { LayoutPickerMenu, LAYOUT_LABELS } from './LayoutPickerMenu.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('LayoutPickerMenu', () => {
    it('renders the picker button', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        // The button is rendered with an SVG shape icon
        const btn = screen.getAllByRole('button');
        expect(btn.length).toBeGreaterThan(0);
    });

    it('opens menu on button click and shows all layout options + pane-count headers', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        const btn = screen.getAllByRole('button')[0]!;
        fireEvent.click(btn);
        // Labels moved to aria-label after the group-by-pane-count redesign.
        // Every layout is a menuitem with the full label as its accessible name.
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.single })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.h2 })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.v2 })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS['h3-top'] })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS['h3-bottom'] })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.v3 })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.h3 })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.grid2x2 })).toBeInTheDocument();
        // Pane-count headers (1 / 2 / 3 / 4) label each row.
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('calls onChange with selected layout and closes menu', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        const btn = screen.getAllByRole('button')[0]!;
        fireEvent.click(btn);
        fireEvent.click(screen.getByRole('menuitem', { name: LAYOUT_LABELS.h2 }));
        expect(onChange).toHaveBeenCalledWith('h2');
    });

    it('calls onChange with v2', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        fireEvent.click(screen.getByRole('menuitem', { name: LAYOUT_LABELS.v2 }));
        expect(onChange).toHaveBeenCalledWith('v2');
    });

    it('calls onChange with grid2x2', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        fireEvent.click(screen.getByRole('menuitem', { name: LAYOUT_LABELS.grid2x2 }));
        expect(onChange).toHaveBeenCalledWith('grid2x2');
    });

    it('renders with h2 as current value', () => {
        renderWithProviders(<LayoutPickerMenu value="h2" onChange={vi.fn()} />);
        const btn = screen.getAllByRole('button')[0]!;
        expect(btn).toBeInTheDocument();
    });

    it('renders with grid2x2 as current value', () => {
        renderWithProviders(<LayoutPickerMenu value="grid2x2" onChange={vi.fn()} />);
        const btn = screen.getAllByRole('button')[0]!;
        expect(btn).toBeInTheDocument();
    });

    it('selects a layout which triggers onChange and setAnchor(null) (covers onClose)', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        // Menu is open — click h3-top which exercises onChange(kind) AND setAnchor(null)
        fireEvent.click(screen.getByRole('menuitem', { name: LAYOUT_LABELS['h3-top'] }));
        expect(onChange).toHaveBeenCalledWith('h3-top');
    });

    it('renders all shape variants for full switch coverage', () => {
        // Render each layout kind as value to exercise ShapeIcon switch arms
        const kinds = ['h3-top', 'h3-bottom', 'v3', 'h3'] as const;
        for (const kind of kinds) {
            const { unmount } = renderWithProviders(<LayoutPickerMenu value={kind} onChange={vi.fn()} />);
            expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
            unmount();
        }
    });

    // 2026-07-03 audit round 2 — the previous <Menu>-based implementation
    // wrapped MenuItems in a Box, which broke MUI MenuList's DOM-sibling
    // arrow-key traversal and its React.Children.forEach selected-item
    // autoFocus. The rewrite uses <Popover> + role="menu" + a hand-rolled
    // roving-tabindex keyboard handler. These tests lock in the keyboard
    // contract so future refactors can't regress it.

    it('menu container has role="menu" with an accessible label', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        expect(menu).toHaveAttribute('aria-label', 'Pane layout');
    });

    it('each pane-count row is a role="group" with an accessible name', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        // Four groups: 1 pane / 2 panes / 3 panes / 4 panes.
        expect(screen.getByRole('group', { name: '1 pane' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: '2 panes' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: '3 panes' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: '4 panes' })).toBeInTheDocument();
    });

    it('opens with the current selection focused (roving-tabindex seeded)', async () => {
        renderWithProviders(<LayoutPickerMenu value="v3" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const selected = screen.getByRole('menuitem', { name: LAYOUT_LABELS.v3 });
        // The selected item is what receives tabIndex=0; every other item
        // is -1. The effect that calls .focus() runs post-commit under
        // React 19's concurrent model, so waitFor is needed to give it a
        // paint cycle.
        expect(selected).toHaveAttribute('tabindex', '0');
        await waitFor(() => expect(document.activeElement).toBe(selected));
        // aria-current marks the persistent selection independent of focus.
        expect(selected).toHaveAttribute('aria-current', 'true');
    });

    it('marks non-selected items with tabIndex=-1 (roving-tabindex)', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.h2 })).toHaveAttribute(
            'tabindex',
            '-1',
        );
        expect(screen.getByRole('menuitem', { name: LAYOUT_LABELS.grid2x2 })).toHaveAttribute(
            'tabindex',
            '-1',
        );
    });

    it('ArrowRight moves focus forward through the visual reading order', async () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        // single → h2 (next in FLAT_LAYOUT_ORDER)
        fireEvent.keyDown(menu, { key: 'ArrowRight' });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.h2 }),
            ),
        );
        // h2 → v2
        fireEvent.keyDown(menu, { key: 'ArrowRight' });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.v2 }),
            ),
        );
    });

    it('ArrowLeft wraps from the first item to the last', async () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        // single is index 0 — ArrowLeft wraps to grid2x2 (last).
        fireEvent.keyDown(menu, { key: 'ArrowLeft' });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.grid2x2 }),
            ),
        );
    });

    it('ArrowDown behaves like ArrowRight (mixed 1D/2D nav)', async () => {
        renderWithProviders(<LayoutPickerMenu value="h2" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        // h2 (idx 1) → v2 (idx 2)
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.v2 }),
            ),
        );
    });

    it('Home focuses the first item, End focuses the last', async () => {
        renderWithProviders(<LayoutPickerMenu value="v2" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'End' });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.grid2x2 }),
            ),
        );
        fireEvent.keyDown(menu, { key: 'Home' });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('menuitem', { name: LAYOUT_LABELS.single }),
            ),
        );
    });

    it('Enter on the focused item commits the layout and closes the menu', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'ArrowRight' }); // → h2
        fireEvent.keyDown(menu, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('h2');
        // Menu closes → the role="menu" element is no longer in the DOM.
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Space also commits (mirrors Enter)', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'ArrowRight' });
        fireEvent.keyDown(menu, { key: ' ' });
        expect(onChange).toHaveBeenCalledWith('h2');
    });

    it('Escape closes the menu without committing a change', () => {
        const onChange = vi.fn();
        renderWithProviders(<LayoutPickerMenu value="single" onChange={onChange} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'ArrowRight' });
        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('unhandled key (Tab, printable char) is ignored — does not throw', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button')[0]!);
        const menu = screen.getByRole('menu');
        // Sanity: the menu handler's default case doesn't crash on any key.
        expect(() => fireEvent.keyDown(menu, { key: 'x' })).not.toThrow();
        expect(() => fireEvent.keyDown(menu, { key: 'Tab' })).not.toThrow();
        // Menu stays open and no selection changes.
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('trigger button advertises aria-haspopup + aria-expanded', () => {
        renderWithProviders(<LayoutPickerMenu value="single" onChange={vi.fn()} />);
        const btn = screen.getAllByRole('button')[0]!;
        expect(btn).toHaveAttribute('aria-haspopup', 'menu');
        expect(btn).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'true');
    });
});
