import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ModelSelect } from './ModelSelect.js';

const BASE = 'http://localhost:3000/api';

const MODEL_CLAUDE = {
    id: 1,
    cli: 'claude' as const,
    model_name: 'claude-opus-4-7',
    sort_order: 1,
    note: null,
};

const MODEL_WITH_NOTE = {
    id: 2,
    cli: 'claude' as const,
    model_name: 'claude-sonnet-4-6',
    sort_order: 2,
    note: 'fast',
};

describe('ModelSelect', () => {
    it('renders without crashing', () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={vi.fn()} />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('size="dialog" branch — FormControl renders without sizeSmall on FormControl itself', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value={MODEL_CLAUDE.model_name} onChange={vi.fn()} size="dialog" />,
        );
        // size="dialog" → FormControl gets size="medium" — the FormControl root should NOT have sizeSmall
        await waitFor(() => {
            const fc = container.querySelector('.MuiFormControl-root');
            expect(fc).toBeTruthy();
            expect(fc?.classList.contains('MuiFormControl-sizeSmall')).toBe(false);
        });
    });

    it('showLabel=true — InputLabel element is rendered with id model-select-claude', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE])),
        );
        const { container } = renderWithProviders(
            <ModelSelect
                cli="claude"
                value={MODEL_CLAUDE.model_name}
                onChange={vi.fn()}
                showLabel
            />,
        );
        await waitFor(() => {
            const label = container.querySelector('#model-select-claude');
            expect(label).toBeTruthy();
            expect(label?.tagName).toBe('LABEL');
        });
    });

    it('renderValue — empty string + hasOptions → "Pick a model…" placeholder', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE])),
        );
        renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={vi.fn()} />,
        );
        await waitFor(() => {
            expect(screen.getByText('Pick a model…')).toBeInTheDocument();
        });
    });

    it('renderValue — empty string + no options → "No models registered for this CLI" placeholder', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={vi.fn()} />,
        );
        await waitFor(() => {
            expect(screen.getAllByText('No models registered for this CLI').length).toBeGreaterThan(0);
        });
    });

    it('!hasOptions — disabled "No models registered" MenuItem shown when select is opened', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={vi.fn()} />,
        );
        await waitFor(() => {
            // placeholder already visible
            expect(screen.getAllByText('No models registered for this CLI').length).toBeGreaterThan(0);
        });
        // Open the select to show the disabled MenuItem
        const combobox = container.querySelector('[role="combobox"]')!;
        fireEvent.mouseDown(combobox);
        await waitFor(() => {
            // The disabled option in the dropdown listbox should now be present
            const options = screen.getAllByRole('option');
            expect(options.length).toBeGreaterThan(0);
        });
    });

    it('m.note truthy — note Typography is rendered inside open menu', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_WITH_NOTE])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value={MODEL_WITH_NOTE.model_name} onChange={vi.fn()} />,
        );
        // Wait for data to load
        await waitFor(() => {
            expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        });
        // Open the select to render options in the portal
        const combobox = container.querySelector('[role="combobox"]')!;
        fireEvent.mouseDown(combobox);
        await waitFor(() => {
            // The note text is "· fast" but may be in a Typography span
            expect(screen.getByText(/fast/)).toBeInTheDocument();
        });
    });

    it('!valueIsKnown && value && hasOptions — stale-value option shown in open menu', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value="stale-model-gone" onChange={vi.fn()} />,
        );
        await waitFor(() => {
            expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        });
        // Open the select to render options in portal
        const combobox = container.querySelector('[role="combobox"]')!;
        fireEvent.mouseDown(combobox);
        await waitFor(() => {
            expect(screen.getByText(/not in registry/)).toBeInTheDocument();
        });
    });

    it('onChange fires with selected model_name when user picks an option', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE, MODEL_WITH_NOTE])),
        );
        const onChange = vi.fn();
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={onChange} />,
        );
        await waitFor(() => {
            expect(screen.getByText('Pick a model…')).toBeInTheDocument();
        });
        // Open the dropdown
        const combobox = container.querySelector('[role="combobox"]')!;
        fireEvent.mouseDown(combobox);
        await waitFor(() => {
            expect(screen.getByRole('listbox')).toBeInTheDocument();
        });
        // Click the first model option
        const opt = screen.getByRole('option', { name: MODEL_CLAUDE.model_name });
        fireEvent.click(opt);
        expect(onChange).toHaveBeenCalledWith(MODEL_CLAUDE.model_name);
    });

    it('fullWidth=false — FormControl renders without fullWidth class', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () => HttpResponse.json([MODEL_CLAUDE])),
        );
        const { container } = renderWithProviders(
            <ModelSelect cli="claude" value="" onChange={vi.fn()} fullWidth={false} />,
        );
        await waitFor(() => {
            const fc = container.querySelector('.MuiFormControl-root');
            expect(fc).toBeTruthy();
            expect(fc?.classList.contains('MuiFormControl-fullWidth')).toBe(false);
        });
    });
});
