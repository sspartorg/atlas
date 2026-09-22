import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: number;
    message: string;
    detail?: string;
    action?: ToastAction;
}

interface ToastCtx {
    toasts: Toast[];
    show: (t: Omit<Toast, 'id'>) => void;
    dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Every auto-dismiss timer still in flight. A toast shown just before the
    // provider unmounts (navigating away, or a test ending) used to leave its
    // 4s timer running with nothing to cancel it: it fired into an unmounted
    // tree, and under jsdom teardown `window` is already gone, so it threw
    // `ReferenceError: window is not defined` from a bare `Timeout._onTimeout`
    // — a failure attributed to whatever test happened to be running 4s later,
    // not to the one that showed the toast.
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: number) => {
        setToasts((xs) => xs.filter((x) => x.id !== id));
    }, []);

    const show = useCallback(
        (t: Omit<Toast, 'id'>) => {
            const id = Date.now() + Math.floor(Math.random() * 1000);
            const next: Toast = { id, message: t.message };
            if (t.detail !== undefined) next.detail = t.detail;
            if (t.action !== undefined) next.action = t.action;
            setToasts((xs) => [...xs, next]);
            const handle = setTimeout(() => {
                timers.current.delete(handle);
                dismiss(id);
            }, AUTO_DISMISS_MS);
            timers.current.add(handle);
        },
        [dismiss]
    );

    // Capture the Set itself: `timers.current` read inside the cleanup would
    // be the ref's value at unmount, which is the same object here, but
    // capturing makes that explicit and satisfies react-hooks/exhaustive-deps.
    useEffect(() => {
        const pending = timers.current;
        return () => {
            for (const handle of pending) clearTimeout(handle);
            pending.clear();
        };
    }, []);

    const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast(): ToastCtx {
    const c = useContext(Ctx);
    if (!c) throw new Error('useToast must be used inside ToastProvider');
    return c;
}
