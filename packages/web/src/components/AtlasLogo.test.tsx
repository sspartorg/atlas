import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AtlasLogo } from './AtlasLogo.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ThemeModeContext, type ThemeModeContextValue } from '../hooks/useThemeModeContext.js';

describe('AtlasLogo', () => {
    it('renders an image with default alt text', () => {
        renderWithProviders(<AtlasLogo />);
        const img = screen.getByRole('img');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('alt', 'Atlas');
    });

    it('renders with custom alt text', () => {
        renderWithProviders(<AtlasLogo alt="Custom Alt" />);
        expect(screen.getByRole('img')).toHaveAttribute('alt', 'Custom Alt');
    });

    it('renders with custom size', () => {
        renderWithProviders(<AtlasLogo size={48} />);
        const img = screen.getByRole('img');
        expect(img).toBeInTheDocument();
    });

    it('uses dark-mode image src by default (light mode default)', () => {
        renderWithProviders(<AtlasLogo />);
        const img = screen.getByRole('img') as HTMLImageElement;
        // Default mode is light, so uses atlas_dark.png
        expect(img.src).toContain('atlas_dark.png');
    });

    it('uses light mark /atlas.png when ThemeModeContext is dark', () => {
        const darkCtx: ThemeModeContextValue = {
            mode: 'dark',
            setMode: () => {},
            toggle: () => {},
        };
        render(
            <ThemeModeContext.Provider value={darkCtx}>
                <AtlasLogo />
            </ThemeModeContext.Provider>,
        );
        const img = screen.getByRole('img') as HTMLImageElement;
        // In dark mode the component picks /atlas.png (light mark on dark bg)
        expect(img.getAttribute('src')).toBe('/atlas.png');
    });
});
