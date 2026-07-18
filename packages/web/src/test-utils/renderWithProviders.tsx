import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { ThemeModeProvider } from '../components/ThemeModeProvider.js';
import { ToastProvider } from '../hooks/useToast.js';

interface ProvidersProps {
    children: ReactNode;
    initialEntries?: MemoryRouterProps['initialEntries'];
    queryClient?: QueryClient;
}

// Mirrors the production provider stack: ThemeProvider → QueryClientProvider
// → MemoryRouter → ToastProvider. A fresh QueryClient per render keeps tests
// isolated from each other's caches; pass a shared one explicitly when a test
// needs to verify cache invalidation across mutations.
function AllProviders({ children, initialEntries, queryClient }: ProvidersProps) {
    const client =
        queryClient ??
        new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    staleTime: 0,
                    gcTime: 0,
                    refetchOnMount: 'always',
                    refetchOnWindowFocus: false,
                    refetchOnReconnect: false,
                },
                mutations: { retry: false },
            },
        });

    // exactOptionalPropertyTypes: spread only when defined so we don't pass
    // `initialEntries: undefined` (which the strict optional contract rejects).
    const routerProps = initialEntries ? { initialEntries } : {};
    return (
        <ThemeModeProvider>
            <QueryClientProvider client={client}>
                <MemoryRouter {...routerProps}>
                    <ToastProvider>{children}</ToastProvider>
                </MemoryRouter>
            </QueryClientProvider>
        </ThemeModeProvider>
    );
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
    initialEntries?: MemoryRouterProps['initialEntries'];
    queryClient?: QueryClient;
}

export function renderWithProviders(
    ui: ReactElement,
    { initialEntries, queryClient, ...options }: RenderWithProvidersOptions = {},
): RenderResult {
    const providerProps = {
        ...(initialEntries ? { initialEntries } : {}),
        ...(queryClient ? { queryClient } : {}),
    };
    return render(ui, {
        wrapper: ({ children }) => (
            <AllProviders {...providerProps}>{children}</AllProviders>
        ),
        ...options,
    });
}

// For hook tests: a renderHook wrapper with the same provider stack.
export function makeWrapper(initialEntries?: MemoryRouterProps['initialEntries']) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <AllProviders initialEntries={initialEntries}>{children}</AllProviders>;
    };
}
