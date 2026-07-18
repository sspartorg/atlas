import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { NotificationStatusPopover } from './NotificationStatusPopover.js';

describe('NotificationStatusPopover', () => {
    it('renders when open with the configured copy', () => {
        renderWithProviders(
            <NotificationStatusPopover anchorEl={document.body} open onClose={vi.fn()} connected />,
        );
        expect(document.body.textContent).toContain('Sending');
    });

    it('renders not-configured copy', () => {
        renderWithProviders(
            <NotificationStatusPopover anchorEl={document.body} open onClose={vi.fn()} connected={false} />,
        );
        expect(document.body.textContent).toContain('Not configured');
    });
});
