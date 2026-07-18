import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { ThemeModeToggle } from './ThemeModeToggle.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

// ThemeModeToggle reads from ThemeModeContext which is provided by
// ThemeModeProvider (wrapped in renderWithProviders via AllProviders).

describe('ThemeModeToggle', () => {
    it('renders radiogroup with two radio buttons', () => {
        renderWithProviders(<ThemeModeToggle />);
        const radioGroup = screen.getByRole('radiogroup');
        expect(radioGroup).toBeInTheDocument();
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(2);
    });

    it('renders Light and Dark options', () => {
        renderWithProviders(<ThemeModeToggle />);
        expect(screen.getByText('Light')).toBeInTheDocument();
        expect(screen.getByText('Dark')).toBeInTheDocument();
    });

    it('Light segment is checked when mode is light', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        );
        expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking Dark changes active segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        );
        fireEvent.click(darkRadio!);
        // Dark should now be checked
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking Light segment sets mode to light', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        );
        fireEvent.click(lightRadio!);
        expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('Enter key activates the segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        fireEvent.keyDown(darkRadio, { key: 'Enter' });
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('Space key activates the segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        fireEvent.keyDown(darkRadio, { key: ' ' });
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('ArrowRight key moves to next segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        )!;
        fireEvent.keyDown(lightRadio, { key: 'ArrowRight' });
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('ArrowDown key moves to next segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        )!;
        fireEvent.keyDown(lightRadio, { key: 'ArrowDown' });
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('ArrowLeft key moves to previous segment (wraps)', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        )!;
        // ArrowLeft from Light wraps to Dark
        fireEvent.keyDown(lightRadio, { key: 'ArrowLeft' });
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('ArrowUp key moves to previous segment', () => {
        renderWithProviders(<ThemeModeToggle />);
        const lightRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Light'),
        )!;
        fireEvent.keyDown(lightRadio, { key: 'ArrowUp' });
        const darkRadio = screen.getAllByRole('radio').find(
            (r) => r.textContent?.includes('Dark'),
        )!;
        expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    });
});
