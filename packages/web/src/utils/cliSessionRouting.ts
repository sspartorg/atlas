import type { ICliSession, CliSessionStatus } from '@atlas/shared';

// Domain rule: where does "look at this session" link to? Live and paused
// sessions go to the live xterm view; closed and errored sessions go to the
// transcript-history view. Centralised here so the Terminal list, the
// multi-pane workspace, and any future card/menu all stay consistent.

export function sessionDetailUrl(session: Pick<ICliSession, 'id' | 'status'>): string {
    return isTerminalStatus(session.status)
        ? `/terminal/${session.id}/history`
        : `/terminal/${session.id}`;
}

export function isTerminalStatus(status: CliSessionStatus): boolean {
    return status === 'closed' || status === 'errored';
}
