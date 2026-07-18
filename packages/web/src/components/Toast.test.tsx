import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../hooks/useToast.js';
import { Toast } from './Toast.js';

function Trigger({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
    const { show } = useToast();
    return (
        <button
            onClick={() => {
                if (action) show({ message, action });
                else show({ message, detail: 'extra' });
            }}
        >
            fire
        </button>
    );
}

describe('Toast', () => {
    it('renders nothing when no toasts', () => {
        const { container } = render(
            <ToastProvider>
                <Toast />
            </ToastProvider>,
        );
        expect(container.querySelector('[role]')).toBeNull();
    });

    it('renders a toast after show + dismisses on action', async () => {
        const onClick = () => undefined;
        render(
            <ToastProvider>
                <Trigger message="Copied" action={{ label: 'Undo', onClick }} />
                <Toast />
            </ToastProvider>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'fire' }));
        expect(await screen.findByText('Copied')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });

    it('renders message + detail', async () => {
        render(
            <ToastProvider>
                <Trigger message="Saved" />
                <Toast />
            </ToastProvider>,
        );
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'fire' }));
        });
        expect(await screen.findByText('Saved')).toBeInTheDocument();
        expect(screen.getByText('extra')).toBeInTheDocument();
    });
});
