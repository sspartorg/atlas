import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { NotificationCard } from './NotificationCard.js';

describe('NotificationCard', () => {
    it('a static card (log) is not a button and shows its alert line', () => {
        renderWithProviders(
            <NotificationCard
                icon={null}
                title="Jira"
                message="m"
                meta="03:17"
                alert="blocked"
                tone="held"
            />
        );
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByText('blocked')).toBeInTheDocument();
    });

    it('puts the chip and its detail on their own status line, not beside the title', () => {
        renderWithProviders(
            <NotificationCard
                icon={null}
                title="Workflow"
                chip={<span>Held · quiet hours</span>}
                chipDetail="sends 08:00"
                message="m"
                meta="ATL-12 · 03:17"
            />
        );
        const status = screen.getByTestId('notification-card-status');
        expect(status).toHaveTextContent('Held · quiet hourssends 08:00');
        expect(screen.getByText('Workflow')).not.toContainElement(status);
        expect(status).not.toHaveTextContent('ATL-12');
    });

    it('renders no status line without a chip', () => {
        renderWithProviders(<NotificationCard icon={null} title="Reminder" message="m" meta="1h" />);
        expect(screen.queryByTestId('notification-card-status')).toBeNull();
    });

    it('a link card opens on click, Enter and Space, and ignores other keys', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <NotificationCard
                icon={null}
                title="Reminder"
                chip={<span>chip</span>}
                message="m"
                meta="1h"
                tone="unread"
                onOpen={onOpen}
            />
        );
        const card = screen.getByRole('button', { name: 'Reminder' });
        fireEvent.click(card);
        fireEvent.keyDown(card, { key: 'Enter' });
        fireEvent.keyDown(card, { key: ' ' });
        fireEvent.keyDown(card, { key: 'a' });
        expect(onOpen).toHaveBeenCalledTimes(3);
        expect(screen.getByText('chip')).toBeInTheDocument();
    });
});
