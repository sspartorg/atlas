import {
    createContext,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { ConfirmActionModal } from '../components/ConfirmActionModal.js';

type ConfirmLeave = (proceed: () => void) => void;

interface IDraftGuardContext {
    dirtyIds: Set<string>;
    confirmLeave: ConfirmLeave;
}

// No provider (isolated component tests) means nothing can be dirty, so leaving
// always proceeds.
const DraftGuardContext = createContext<IDraftGuardContext>({
    dirtyIds: new Set(),
    confirmLeave: (proceed) => proceed(),
});

// The app runs on <BrowserRouter>, so react-router's useBlocker is unavailable.
// App-level navigations (g+<key> shortcuts, Sidenav, mobile nav) route through
// useConfirmLeave instead; in-page links on a draft form stay deliberate exits.
export function DraftGuardProvider({ children }: { children: ReactNode }) {
    const dirtyIds = useRef(new Set<string>()).current;
    const [pending, setPending] = useState<(() => void) | null>(null);
    const value = useMemo<IDraftGuardContext>(
        () => ({
            dirtyIds,
            confirmLeave: (proceed) => {
                if (dirtyIds.size === 0) proceed();
                else setPending(() => proceed);
            },
        }),
        [dirtyIds]
    );
    return (
        <DraftGuardContext.Provider value={value}>
            {children}
            <ConfirmActionModal
                open={pending !== null}
                title="Discard draft?"
                body="You have unsaved changes. Leaving this page throws them away."
                confirmLabel="Discard"
                tone="destructive"
                onCancel={() => setPending(null)}
                onConfirm={() => {
                    dirtyIds.clear();
                    setPending(null);
                    pending?.();
                }}
            />
        </DraftGuardContext.Provider>
    );
}

export function useDraftGuard(dirty: boolean): void {
    const { dirtyIds } = useContext(DraftGuardContext);
    const id = useId();
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
        dirtyIds.add(id);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            dirtyIds.delete(id);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    }, [dirty, dirtyIds, id]);
}

export function useConfirmLeave(): ConfirmLeave {
    return useContext(DraftGuardContext).confirmLeave;
}
