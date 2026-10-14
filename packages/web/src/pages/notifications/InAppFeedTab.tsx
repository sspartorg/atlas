import type { INotification } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { InAppFeedTabContent } from './InAppFeedTabContent.js';
import type { AgentSummary } from '../../api/types.js';

interface Props {
    allRows: INotification[];
    agents: AgentSummary[];
}

// See NotificationLogTab.tsx for the wrapper-vs-content rationale.
export function InAppFeedTab(props: Props) {
    useDeferredMount();
    return <InAppFeedTabContent {...props} />;
}
