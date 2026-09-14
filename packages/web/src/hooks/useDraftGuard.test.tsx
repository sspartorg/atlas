import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { DraftGuardProvider, useConfirmLeave, useDraftGuard } from './useDraftGuard.js';
import { useGlobalShortcuts } from './useGlobalShortcuts.js';

function Where() {
    return <span data-testid="where">{useLocation().pathname}</span>;
}

function Draft({ dirty }: { dirty: boolean }) {
    useDraftGuard(dirty);
    return null;
}

function Leave({ onLeave }: { onLeave: () => void }) {
    const confirmLeave = useConfirmLeave();
    return <button onClick={() => confirmLeave(onLeave)}>leave</button>;
}

function Shortcuts() {
    useGlobalShortcuts({ onOpenShortcuts: () => {} });
    return null;
}

describe('useDraftGuard', () => {
    it('proceeds immediately when nothing is dirty', () => {
        const onLeave = vi.fn();
        renderWithProviders(
            <DraftGuardProvider>
                <Draft dirty={false} />
                <Leave onLeave={onLeave} />
            </DraftGuardProvider>,
        );
        fireEvent.click(screen.getByText('leave'));
        expect(onLeave).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Discard draft?')).not.toBeInTheDocument();
    });

    it('asks before leaving a dirty draft; Cancel keeps it, Discard proceeds', async () => {
        const onLeave = vi.fn();
        renderWithProviders(
            <DraftGuardProvider>
                <Draft dirty />
                <Leave onLeave={onLeave} />
            </DraftGuardProvider>,
        );
        fireEvent.click(screen.getByText('leave'));
        expect(await screen.findByText('Discard draft?')).toBeInTheDocument();
        expect(onLeave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText('Discard draft?')).not.toBeInTheDocument());
        expect(onLeave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('leave'));
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('stops guarding once the draft unmounts', () => {
        const onLeave = vi.fn();
        const { rerender } = renderWithProviders(
            <DraftGuardProvider>
                <Draft dirty />
                <Leave onLeave={onLeave} />
            </DraftGuardProvider>,
        );
        rerender(
            <DraftGuardProvider>
                <Leave onLeave={onLeave} />
            </DraftGuardProvider>,
        );
        fireEvent.click(screen.getByText('leave'));
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('blocks the browser unload only while dirty', () => {
        const { rerender } = renderWithProviders(<Draft dirty />);
        const dirtyEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirtyEvent);
        expect(dirtyEvent.defaultPrevented).toBe(true);

        rerender(<Draft dirty={false} />);
        const cleanEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanEvent);
        expect(cleanEvent.defaultPrevented).toBe(false);
    });

    it('proceeds without a provider (isolated component tests)', () => {
        const onLeave = vi.fn();
        renderWithProviders(<Leave onLeave={onLeave} />);
        fireEvent.click(screen.getByText('leave'));
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('guards the g+<key> shortcut so a typed draft is not silently dropped', async () => {
        renderWithProviders(
            <DraftGuardProvider>
                <Draft dirty />
                <Shortcuts />
                <Where />
            </DraftGuardProvider>,
            { initialEntries: ['/epics/new'] },
        );
        fireEvent.keyDown(window, { key: 'g' });
        fireEvent.keyDown(window, { key: 'e' });
        expect(await screen.findByText('Discard draft?')).toBeInTheDocument();
        expect(screen.getByTestId('where')).toHaveTextContent('/epics/new');

        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/epics$/));
    });
});
