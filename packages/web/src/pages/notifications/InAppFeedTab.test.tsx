import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { InAppFeedTab } from './InAppFeedTab.js';

vi.mock('./InAppFeedTabContent.js', () => ({
    InAppFeedTabContent: (props: unknown) => (
        <div data-testid="iaf-content" data-props={JSON.stringify(props)} />
    ),
}));

describe('InAppFeedTab', () => {
    it('renders InAppFeedTabContent with the forwarded props', () => {
        const { getByTestId } = renderWithProviders(
            <InAppFeedTab allRows={[]} agents={[]} />,
        );
        const stub = getByTestId('iaf-content');
        expect(stub).toBeInTheDocument();
        const props = JSON.parse(stub.dataset['props'] ?? '{}');
        expect(props).toEqual({ allRows: [], agents: [] });
    });

    it('forwards non-empty allRows + agents', () => {
        const { getByTestId } = renderWithProviders(
            <InAppFeedTab
                allRows={[{ id: 1 } as never, { id: 2 } as never]}
                agents={[{ id: 'a' } as never]}
            />,
        );
        const props = JSON.parse(getByTestId('iaf-content').dataset['props'] ?? '{}');
        expect(props.allRows).toEqual([{ id: 1 }, { id: 2 }]);
        expect(props.agents).toEqual([{ id: 'a' }]);
    });
});
