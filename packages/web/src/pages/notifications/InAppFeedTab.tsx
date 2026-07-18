import type { IAgent, INotification } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { InAppFeedTabContent } from './InAppFeedTabContent.js';

interface Props {
    allRows: INotification[];
    agents: IAgent[];
}

// See NotificationLogTab.tsx for the wrapper-vs-content rationale.
export function InAppFeedTab(props: Props) {
    useDeferredMount();
    return <InAppFeedTabContent {...props} />;
}
