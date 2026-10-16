import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { NotificationStatusPopover } from './NotificationStatusPopover.js';

function serve(settings: Record<string, unknown>, unread: number) {
    server.use(
        http.get('*/api/settings', () => HttpResponse.json({ external_notification_provider: 'telegram', ...settings })),
        http.get('*/api/counts', () =>
            HttpResponse.json({ projects: 0, tasks: 0, queue: 0, agents: 0, notifications: unread })
        )
    );
}

const open = () => renderWithProviders(<NotificationStatusPopover anchorEl={document.body} open onClose={vi.fn()} />);

describe('NotificationStatusPopover', () => {
    it('names the sending provider, its endpoint and the unread count', async () => {
        serve(
            { external_notification_token_set: true, external_notification_chat_id: '42', external_notification_endpoint_label: '@atlas_bot' },
            3
        );
        open();
        expect(await screen.findByText('Sending via Telegram')).toBeInTheDocument();
        expect(screen.getByText('Connected to @atlas_bot.')).toBeInTheDocument();
        expect(await screen.findByText('3 unread notifications')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open notifications' })).toHaveAttribute('href', '/notifications?tab=in-app');
        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings?tab=notifications');
    });

    it('Teams set up but untested; one unread', async () => {
        serve({ external_notification_provider: 'teams', external_notification_webhook_url_set: true }, 1);
        open();
        expect(await screen.findByText('Sending via Microsoft Teams')).toBeInTheDocument();
        expect(screen.getByText('Set up, not tested yet.')).toBeInTheDocument();
        expect(await screen.findByText('1 unread notification')).toBeInTheDocument();
    });

    it('a Telegram token left behind after switching to Teams is not a channel', async () => {
        serve({ external_notification_provider: 'teams', external_notification_token_set: true, external_notification_chat_id: '42' }, 0);
        open();
        expect(await screen.findByText('No external channel')).toBeInTheDocument();
        expect(screen.getByText('No unread notifications')).toBeInTheDocument();
    });
});
