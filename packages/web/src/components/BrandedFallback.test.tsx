import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { BrandedFallback } from './BrandedFallback.js';

describe('BrandedFallback', () => {
    it('renders the brand logo and a progress spinner', () => {
        renderWithProviders(<BrandedFallback />);
        const img = document.querySelector('img');
        expect(img).toBeInTheDocument();
        expect(img?.getAttribute('src')).toMatch(/atlas/);
        expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });
});
