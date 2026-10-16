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
