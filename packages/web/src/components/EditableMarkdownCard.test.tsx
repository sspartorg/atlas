import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { EditableMarkdownCard } from './EditableMarkdownCard.js';

describe('EditableMarkdownCard', () => {
    it('renders read-mode body and toggles to edit', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <EditableMarkdownCard title="Plan" value="# heading" onSave={onSave} />,
        );
        expect(screen.getByText('Plan')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows empty hint when value is null and starts edit on click', async () => {
        const onSave = vi.fn();
        renderWithProviders(
            <EditableMarkdownCard
                title="Plan"
                value={null}
                onSave={onSave}
                emptyHint="Click to write"
            />,
        );
        await userEvent.click(screen.getByText('Click to write'));
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('saves the draft on Save', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <EditableMarkdownCard title="Plan" value="existing" onSave={onSave} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
        const tb = screen.getByRole('textbox');
        await userEvent.clear(tb);
        await userEvent.type(tb, 'new text');
        await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
        expect(onSave).toHaveBeenCalledWith('new text');
    });

    it('Cancel button leaves edit mode without saving', async () => {
        const onSave = vi.fn();
        renderWithProviders(
            <EditableMarkdownCard title="Plan" value="existing" onSave={onSave} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('renders meta slot between title bar and body (meta branch)', () => {
        renderWithProviders(
            <EditableMarkdownCard
                title="Plan"
                value="some body text"
                onSave={vi.fn()}
                meta={<span data-testid="meta-slot">By Alice</span>}
            />,
        );
        expect(screen.getByTestId('meta-slot')).toBeInTheDocument();
        // meta is NOT rendered in edit mode
    });

    it('meta is hidden when in editing mode (meta+editing branch)', async () => {
        renderWithProviders(
            <EditableMarkdownCard
                title="Plan"
                value="body"
                onSave={vi.fn()}
                meta={<span data-testid="meta-slot">By Alice</span>}
            />,
        );
        expect(screen.getByTestId('meta-slot')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
        // In edit mode the meta block is conditionally hidden
        expect(screen.queryByTestId('meta-slot')).not.toBeInTheDocument();
    });

    it('uses renderBody when provided (renderBody truthy branch)', () => {
        const renderBody = vi.fn((v: string) => <ul><li>{v}</li></ul>);
        renderWithProviders(
            <EditableMarkdownCard
                title="Plan"
                value="my-item"
                onSave={vi.fn()}
                renderBody={renderBody}
            />,
        );
        expect(renderBody).toHaveBeenCalledWith('my-item');
        expect(screen.getByText('my-item')).toBeInTheDocument();
    });

    it('disables Save and Cancel when saving=true', async () => {
        const onSave = vi.fn();
        renderWithProviders(
            <EditableMarkdownCard title="Plan" value="existing" onSave={onSave} saving />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
        const saveBtn = screen.getByRole('button', { name: /^Save$/ });
        const cancelBtn = screen.getByRole('button', { name: /^Cancel$/ });
        expect(saveBtn).toBeDisabled();
        expect(cancelBtn).toBeDisabled();
    });

    it('shows default empty hint "Click to add…" when no emptyHint provided', async () => {
        renderWithProviders(
            <EditableMarkdownCard title="Plan" value={null} onSave={vi.fn()} />,
        );
        expect(screen.getByText('Click to add…')).toBeInTheDocument();
        // Click the default hint to enter edit mode
        await userEvent.click(screen.getByText('Click to add…'));
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
});
