import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../hooks/useToast.js';
import { Toast } from './Toast.js';

function Trigger({
    message,
    action,
}: {
    message: string;
    action?: { label: string; onClick: () => void };
}) {
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
            </ToastProvider>
        );
        expect(container.querySelector('[role]')).toBeNull();
    });

    it('renders a toast after show + dismisses on action', async () => {
        const onClick = () => undefined;
        render(
            <ToastProvider>
                <Trigger message="Copied" action={{ label: 'Undo', onClick }} />
                <Toast />
            </ToastProvider>
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
            </ToastProvider>
        );
        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'fire' }));
        });
        expect(await screen.findByText('Saved')).toBeInTheDocument();
        expect(screen.getByText('extra')).toBeInTheDocument();
    });

    it.each([
        ["Couldn't save APL-1", 'ErrorOutlineRounded'],
        ['Could not load tasks', 'ErrorOutlineRounded'],
        ['Jira sync failed', 'ErrorOutlineRounded'],
        ['Clipboard blocked', 'ErrorOutlineRounded'],
        ['Branch copied', 'LinkRounded'],
        ['Setup scripts saved for web', 'FolderOpenRounded'],
    ])('"%s" shows the %s icon', async (message, icon) => {
        render(
            <ToastProvider>
                <Trigger message={message} />
                <Toast />
            </ToastProvider>
        );
        await userEvent.click(screen.getByRole('button', { name: 'fire' }));
        await screen.findByText(message);
        expect(document.querySelector(`[data-testid="${icon}Icon"]`)).not.toBeNull();
    });
});

