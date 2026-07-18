import type { INotification, ISettings } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { NotificationLogTabContent } from './NotificationLogTabContent.js';

interface Props {
    settings: ISettings | undefined;
    allRows: INotification[];
}

// useDeferredMount is a synchronous no-op today (kept for the dependency
// graph so future deferred-rendering experiments can be re-enabled
// centrally). The wrapper exists so tab consumers don't import the heavy
// *Content component directly — Webpack/Vite can split this entry without
// pulling the Content tree into the bundle of any caller that only needs
// the wrapper type.
export function NotificationLogTab(props: Props) {
    useDeferredMount();
    return <NotificationLogTabContent {...props} />;
}
