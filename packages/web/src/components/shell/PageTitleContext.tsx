import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';

export interface PageTitle {
    title: string;
    subtitle?: ReactNode;
    trailing?: ReactNode;
}

type SetPageTitle = (next: PageTitle | null) => void;

// Split into two contexts so the setter is referentially stable across renders.
// Why: useState's setCurrent is already stable, so threading it through its own
// context means usePageTitleSetter returns the same function forever, which lets
// pages put it in useEffect deps without triggering "Maximum update depth" loops.
const PageTitleValueContext = createContext<PageTitle | null>(null);
const noopSetter: SetPageTitle = () => {};
const PageTitleSetterContext = createContext<SetPageTitle>(noopSetter);

export function PageTitleProvider({ children }: { children: ReactNode }) {
    const [current, setCurrent] = useState<PageTitle | null>(null);
    return (
        <PageTitleSetterContext.Provider value={setCurrent}>
            <PageTitleValueContext.Provider value={current}>
                {children}
            </PageTitleValueContext.Provider>
        </PageTitleSetterContext.Provider>
    );
}

export function usePageTitle(): PageTitle | null {
    return useContext(PageTitleValueContext);
}

export function usePageTitleSetter(): SetPageTitle {
    return useContext(PageTitleSetterContext);
}

// Convenience for the common case: a page with a static title and no trailing.
// Equivalent to: usePageTitleSetter() + useEffect that sets/clears.
export function useSetPageTitle(title: string, subtitle?: ReactNode): void {
    const set = usePageTitleSetter();
    useEffect(() => {
        set({ title, subtitle });
        return () => set(null);
    }, [set, title, subtitle]);
}
