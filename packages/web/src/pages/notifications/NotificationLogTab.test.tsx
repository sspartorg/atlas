import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { NotificationLogTab } from './NotificationLogTab.js';

// The Content component is heavy and uses many hooks. The tab wrapper
// is now a pure passthrough — verify it forwards to Content rather than
// re-rendering its internal logic. Mocking the Content keeps the test
// stable against future Content-internal refactors.
vi.mock('./NotificationLogTabContent.js', () => ({
    NotificationLogTabContent: (props: unknown) => (
        <div data-testid="nlt-content" data-props={JSON.stringify(props)} />
    ),
}));

describe('NotificationLogTab', () => {
    it('renders NotificationLogTabContent with the forwarded props', () => {
        const { getByTestId } = renderWithProviders(
            <NotificationLogTab settings={undefined} allRows={[]} />,
        );
        const stub = getByTestId('nlt-content');
        expect(stub).toBeInTheDocument();
        const props = JSON.parse(stub.dataset['props'] ?? '{}');
        expect(props).toEqual({ allRows: [] });
    });

    it('forwards settings when provided', () => {
        const settings = { id: 1, owner_name: 'O', onboarding_complete: 1 };
        const { getByTestId } = renderWithProviders(
            <NotificationLogTab settings={settings as never} allRows={[{ id: 7 } as never]} />,
        );
        const props = JSON.parse(getByTestId('nlt-content').dataset['props'] ?? '{}');
        expect(props.settings).toEqual(settings);
        expect(props.allRows).toEqual([{ id: 7 }]);
    });
});
