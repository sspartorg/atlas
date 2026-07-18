import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface IGlobalShortcutOptions {
    onOpenShortcuts: () => void;
}

const GOTO_MAP: Record<string, string> = {
    d: '/dashboard',
    p: '/projects',
    e: '/epics',
    i: '/issues',
    q: '/queue',
    a: '/agents',
    n: '/notifications',
    s: '/settings',
};

const GOTO_TIMEOUT_MS = 1200;

export function useGlobalShortcuts({ onOpenShortcuts }: IGlobalShortcutOptions) {
    const navigate = useNavigate();

    useEffect(() => {
        let gotoPending = false;
        let gotoTimer: number | null = null;

        function clearPending() {
            gotoPending = false;
            if (gotoTimer !== null) {
                window.clearTimeout(gotoTimer);
                gotoTimer = null;
            }
        }

        function handler(e: KeyboardEvent) {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                clearPending();
                onOpenShortcuts();
                return;
            }
            if (e.key === '?') {
                e.preventDefault();
                clearPending();
                onOpenShortcuts();
                return;
            }
            // Bare-key shortcuts must not fire while modifiers are held.
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            if (gotoPending) {
                const path = GOTO_MAP[e.key.toLowerCase()];
                clearPending();
                if (path) {
                    e.preventDefault();
                    navigate(path);
                }
                return;
            }
            if (e.key.toLowerCase() === 'g') {
                e.preventDefault();
                gotoPending = true;
                gotoTimer = window.setTimeout(clearPending, GOTO_TIMEOUT_MS);
            }
        }
        window.addEventListener('keydown', handler);
        return () => {
            window.removeEventListener('keydown', handler);
            clearPending();
        };
    }, [onOpenShortcuts, navigate]);
}
