import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { GlyphPickerModal } from './GlyphPickerModal.js';

const BASE = 'http://localhost:3000/api';

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('GlyphPickerModal', () => {
    it('renders "Replace glyph" title when open', () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Replace glyph')).toBeTruthy();
    });

    it('renders 16 glyph buttons', () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        const buttons = screen.getAllByRole('button');
        // 16 glyph buttons + Cancel + Save = at least 18; filter to those with aria-pressed
        const glyphButtons = buttons.filter(
            (b) => b.getAttribute('aria-pressed') !== null,
        );
        expect(glyphButtons).toHaveLength(16);
    });

    it('renders Cancel and Save buttons', () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
    });

    it('marks the currentGlyph as selected (aria-pressed=true)', () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        const coderBtn = screen.getByRole('button', { name: 'Coder' });
        expect(coderBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('clicking a glyph selects it (aria-pressed becomes true)', async () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        const designBtn = screen.getByRole('button', { name: 'Design' });
        expect(designBtn.getAttribute('aria-pressed')).toBe('false');
        await userEvent.click(designBtn);
        expect(designBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('Save without change calls onClose (no PATCH)', async () => {
        const onClose = vi.fn();
        const agent = makeAgent();
        // If a PATCH is made unexpectedly, MSW will throw an unhandled-request error.
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={onClose}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Save with new glyph calls PATCH /api/agents/:id', async () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/agents/agent-coder`, () => {
                patched = true;
                return HttpResponse.json(makeAgent());
            }),
        );
        const onClose = vi.fn();
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={onClose}
            />,
        );
        // Click a different glyph
        await userEvent.click(screen.getByRole('button', { name: 'Design' }));
        await userEvent.click(screen.getByRole('button', { name: /save/i }));
        await waitFor(() => expect(patched).toBe(true));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('Cancel calls onClose', async () => {
        const onClose = vi.fn();
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={true}
                agent={agent}
                currentGlyph="terminal"
                onClose={onClose}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not render when open is false', () => {
        const agent = makeAgent();
        renderWithProviders(
            <GlyphPickerModal
                open={false}
                agent={agent}
                currentGlyph="terminal"
                onClose={vi.fn()}
            />,
        );
        expect(screen.queryByText('Replace glyph')).toBeNull();
    });
});
