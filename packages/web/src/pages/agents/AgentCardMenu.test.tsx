import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentCardMenu } from './AgentCardMenu.js';

describe('AgentCardMenu', () => {
    it('renders a trigger icon', () => {
        renderWithProviders(<AgentCardMenu actions={{}} />);
        // The trigger box contains the more_vert span; there should be a clickable element
        expect(screen.getByText('more_vert')).toBeTruthy();
    });

    it('clicking trigger opens the menu', async () => {
        renderWithProviders(
            <AgentCardMenu
                actions={{
                    onDuplicate: vi.fn(),
                    onDelete: vi.fn(),
                }}
            />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Duplicate')).toBeTruthy();
        expect(screen.getByText('Delete')).toBeTruthy();
    });

    it('shows Pause when paused is false', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onPause: vi.fn(), paused: false }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Pause')).toBeTruthy();
        expect(screen.queryByText('Resume')).toBeNull();
    });

    it('shows Resume when paused is true', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onPause: vi.fn(), paused: true }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Resume')).toBeTruthy();
        expect(screen.queryByText('Pause')).toBeNull();
    });

    it('shows Open when onOpen is provided', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onOpen: vi.fn() }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Open')).toBeTruthy();
    });

    it('does not show Open when onOpen is not provided', async () => {
        renderWithProviders(<AgentCardMenu actions={{}} />);
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.queryByText('Open')).toBeNull();
    });

    it('shows Edit when onEdit is provided', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onEdit: vi.fn() }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Edit')).toBeTruthy();
    });

    it('shows Export zip when onExport is provided', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onExport: vi.fn() }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Export zip')).toBeTruthy();
    });

    it('clicking Duplicate calls onDuplicate and closes menu', async () => {
        const onDuplicate = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onDuplicate }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Duplicate'));
        expect(onDuplicate).toHaveBeenCalledTimes(1);
    });

    it('clicking Delete calls onDelete', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onDelete }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Delete'));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('clicking Pause calls onPause', async () => {
        const onPause = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onPause, paused: false }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Pause'));
        expect(onPause).toHaveBeenCalledTimes(1);
    });

    it('clicking Open calls onOpen (covers run() return value path)', async () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onOpen }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Open'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('clicking Export zip calls onExport (covers run() with fn path)', async () => {
        const onExport = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onExport }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Export zip'));
        expect(onExport).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape closes the menu (covers Menu onClose handler)', async () => {
        renderWithProviders(
            <AgentCardMenu actions={{ onDuplicate: vi.fn() }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        expect(screen.getByText('Duplicate')).toBeInTheDocument();
        // Pressing Escape fires MUI Menu onClose → setOpen(false)
        await userEvent.keyboard('{Escape}');
        await waitFor(() =>
            expect(screen.queryByText('Duplicate')).not.toBeInTheDocument(),
        );
    });

    it('clicking Edit calls onEdit', async () => {
        const onEdit = vi.fn();
        renderWithProviders(
            <AgentCardMenu actions={{ onEdit }} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        await userEvent.click(screen.getByText('Edit'));
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('clicking Duplicate when onDuplicate is undefined does not throw (run(undefined) fn?.() branch)', async () => {
        // Actions without onDuplicate — run(undefined) fires fn?.() where fn is undefined
        renderWithProviders(
            <AgentCardMenu actions={{}} />,
        );
        await userEvent.click(screen.getByText('more_vert'));
        // Menu must be open (Duplicate item is always rendered even without handler)
        const dupItem = screen.queryByText('Duplicate');
        if (dupItem) {
            await userEvent.click(dupItem);
            // No crash — fn?.() is a no-op
        }
    });
});
