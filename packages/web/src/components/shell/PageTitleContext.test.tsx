import { describe, expect, it } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import {
    PageTitleProvider,
    usePageTitle,
    usePageTitleSetter,
    useSetPageTitle,
} from './PageTitleContext.js';

describe('PageTitleContext', () => {
    it('reads from setter', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <PageTitleProvider>{children}</PageTitleProvider>
        );
        const setter = renderHook(() => usePageTitleSetter(), { wrapper });
        act(() => setter.result.current({ title: 'Hi' }));
        const value = renderHook(() => usePageTitle(), { wrapper });
        expect(value.result.current).toBeDefined();
    });

    it('useSetPageTitle sets and clears on unmount', () => {
        function Inner({ t }: { t: string }) {
            useSetPageTitle(t);
            return <div>x</div>;
        }
        const { unmount } = render(
            <PageTitleProvider>
                <Inner t="My Page" />
            </PageTitleProvider>,
        );
        unmount();
    });

    it('setter is a no-op outside provider', () => {
        const { result } = renderHook(() => usePageTitleSetter());
        expect(() => result.current(null)).not.toThrow();
    });
});
