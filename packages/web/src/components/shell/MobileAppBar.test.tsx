import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { PageTitleProvider, useSetPageTitle, usePageTitleSetter } from './PageTitleContext.js';
import { MobileAppBar } from './MobileAppBar.js';
import { useEffect } from 'react';

function Setter() {
    useSetPageTitle('Hello');
    return null;
}

function SetterWithSubtitle() {
    useSetPageTitle('Main Title', 'My Subtitle');
    return null;
}

function SetterWithTrailing() {
    const set = usePageTitleSetter();
    useEffect(() => {
        set({ title: 'Trail Title', trailing: <span data-testid="trail-content">Trail</span> });
        return () => set(null);
    }, [set]);
    return null;
}

describe('MobileAppBar', () => {
    it('renders the page title from context', () => {
        renderWithProviders(
            <PageTitleProvider>
                <Setter />
                <MobileAppBar />
            </PageTitleProvider>,
        );
        expect(screen.getAllByText('Hello').length).toBeGreaterThan(0);
    });

    it('falls back to "Atlas" without a title', () => {
        renderWithProviders(<MobileAppBar />);
        expect(screen.getAllByText('Atlas').length).toBeGreaterThan(0);
    });

    it('renders subtitle when provided via useSetPageTitle', () => {
        renderWithProviders(
            <PageTitleProvider>
                <SetterWithSubtitle />
                <MobileAppBar />
            </PageTitleProvider>,
        );
        expect(screen.getByText('My Subtitle')).toBeInTheDocument();
        expect(screen.getByText('Main Title')).toBeInTheDocument();
    });

    it('renders trailing content when set via usePageTitleSetter', () => {
        renderWithProviders(
            <PageTitleProvider>
                <SetterWithTrailing />
                <MobileAppBar />
            </PageTitleProvider>,
        );
        expect(screen.getByTestId('trail-content')).toBeInTheDocument();
    });
});
