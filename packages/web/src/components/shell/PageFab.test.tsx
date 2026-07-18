import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { PageFab } from './PageFab.js';

let isMobileValue = false;
vi.mock('../../hooks/useIsMobile.js', () => ({
    useIsMobile: () => isMobileValue,
}));

describe('PageFab', () => {
    afterEach(() => {
        isMobileValue = false;
    });

    it('renders nothing on non-mobile', () => {
        isMobileValue = false;
        const { container } = renderWithProviders(<PageFab label="New" onClick={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the FAB on mobile and fires onClick', () => {
        isMobileValue = true;
        const onClick = vi.fn();
        renderWithProviders(<PageFab label="New" onClick={onClick} />);
        const fab = screen.getByRole('button', { name: /new/i });
        fireEvent.click(fab);
        expect(onClick).toHaveBeenCalled();
    });

    it('honors the custom icon prop', () => {
        isMobileValue = true;
        renderWithProviders(
            <PageFab label="Refresh" icon="refresh" onClick={vi.fn()} />,
        );
        expect(screen.getByText('refresh')).toBeInTheDocument();
    });
});
