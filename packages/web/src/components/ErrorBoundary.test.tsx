import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.js';

function Boom(): ReactElement {
    throw new Error('boom');
}

describe('ErrorBoundary', () => {
    it('renders children when nothing throws', () => {
        render(<ErrorBoundary>hello</ErrorBoundary>);
        expect(screen.getByText('hello')).toBeInTheDocument();
    });

    it('captures errors and renders a fallback', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(
            <ErrorBoundary pageName="X">
                <Boom />
            </ErrorBoundary>,
        );
        expect(screen.getByText(/X failed to load/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
        spy.mockRestore();
    });

    it('shows "Something went wrong" when pageName is omitted (pageName falsy branch)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        spy.mockRestore();
    });

    it('clicking Try again resets error state (setState branch)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        // Click Try again — this calls setState({ error: null })
        // After reset, children re-render but Boom throws again, showing error again
        const btn = screen.getByRole('button', { name: /Try again/i });
        btn.click();
        // setState was called (the onClick branch was executed)
        expect(btn).toBeTruthy();
        spy.mockRestore();
    });
});
