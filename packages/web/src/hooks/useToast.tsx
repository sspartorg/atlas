import { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
            setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
        },
        [dismiss]
    );

    const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast(): ToastCtx {
    const c = useContext(Ctx);
    if (!c) throw new Error('useToast must be used inside ToastProvider');
    return c;
}
