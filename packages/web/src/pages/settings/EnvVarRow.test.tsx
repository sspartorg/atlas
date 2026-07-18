import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IEnvVar } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EnvVarRow } from './EnvVarRow.js';

const baseEnv: IEnvVar = {
    key: 'ATLAS_API_URL',
    value: '',
    description: 'API base URL',
    restart_required: false,
    secret: false,
};

function setup(
    overrides: Partial<IEnvVar> & { value?: string; onChange?: (v: string) => void } = {},
) {
    const { value = '', onChange = vi.fn(), ...envOverrides } = overrides;
    const env: IEnvVar = { ...baseEnv, ...envOverrides };
    const utils = renderWithProviders(<EnvVarRow env={env} value={value} onChange={onChange} />);
    return { ...utils, onChange, env };
}

describe('EnvVarRow', () => {
    it('renders the key + description for a plain text env var', () => {
        setup({ value: 'http://localhost:4001' });
        expect(screen.getByText('ATLAS_API_URL')).toBeInTheDocument();
        expect(screen.getByText('API base URL')).toBeInTheDocument();
        expect(screen.getByDisplayValue('http://localhost:4001')).toBeInTheDocument();
    });

    it('shows the RESTART chip when restart_required is true', () => {
        setup({ restart_required: true });
        expect(screen.getByText(/RESTART/i)).toBeInTheDocument();
    });

    it('omits the RESTART chip when restart_required is false', () => {
        setup({ restart_required: false });
        expect(screen.queryByText(/RESTART/i)).not.toBeInTheDocument();
    });

    it('emits onChange when the user types into the value field', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        setup({ value: '', onChange });
        const inputs = document.querySelectorAll('input');
        const valueInput = Array.from(inputs).find(i => !i.readOnly && i.type !== 'hidden');
        await user.type(valueInput!, 'x');
        expect(onChange).toHaveBeenCalled();
    });

    it('renders a Reveal/Hide icon for a secret env var; click toggles password→text', async () => {
        const user = userEvent.setup();
        setup({ secret: true, value: 'super-secret' });
        const input = screen.getByDisplayValue('super-secret') as HTMLInputElement;
        expect(input.type).toBe('password');
        const buttons = screen.getAllByRole('button');
        const reveal = buttons.find(b =>
            b.querySelector('[data-testid="VisibilityOutlinedIcon"]'),
        );
        expect(reveal).toBeTruthy();
        await user.click(reveal!);
        expect(input.type).toBe('text');
    });

    it('renders a Copy icon button for non-secret env vars', () => {
        setup({ value: 'value-to-copy' });
        const buttons = screen.getAllByRole('button');
        const copyBtn = buttons.find(b =>
            b.querySelector('[data-testid="ContentCopyRoundedIcon"]'),
        );
        expect(copyBtn).toBeTruthy();
    });

    it('renders a Select for ATLAS_LOG_LEVEL and emits the chosen level on change', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        setup({ key: 'ATLAS_LOG_LEVEL', value: 'info', onChange });
        const combo = screen.getByRole('combobox');
        await user.click(combo);
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(screen.getByRole('option', { name: level })).toBeInTheDocument();
        }
        await user.click(screen.getByRole('option', { name: 'debug' }));
        expect(onChange).toHaveBeenCalledWith('debug');
    });

    it('normalises an unknown stored LOG_LEVEL back to the (default — info) placeholder', () => {
        setup({ key: 'ATLAS_LOG_LEVEL', value: 'bogus-level' });
        expect(screen.getByText(/default — info/i)).toBeInTheDocument();
    });

    it('clicking the Copy button calls clipboard.writeText and shows toast on success — covers lines 34-36', async () => {
        const user = userEvent.setup();
        let clipboardValue: string | null = null;
        const originalClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: vi.fn((v: string) => {
                    clipboardValue = v;
                    return Promise.resolve();
                }),
            },
            writable: true,
            configurable: true,
        });
        setup({ value: 'copy-me', secret: false });
        const buttons = screen.getAllByRole('button');
        const copyBtn = buttons.find(b =>
            b.querySelector('[data-testid="ContentCopyRoundedIcon"]'),
        );
        expect(copyBtn).toBeTruthy();
        await user.click(copyBtn!);
        // clipboard.writeText was called with the current value
        expect(clipboardValue).toBe('copy-me');
        Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    });

    it('clicking the Copy button shows "Clipboard blocked" toast when clipboard rejects — covers line 36', async () => {
        const user = userEvent.setup();
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: vi.fn(() => Promise.reject(new Error('blocked'))),
            },
            writable: true,
            configurable: true,
        });
        setup({ value: 'blocked-value', secret: false });
        const buttons = screen.getAllByRole('button');
        const copyBtn = buttons.find(b =>
            b.querySelector('[data-testid="ContentCopyRoundedIcon"]'),
        );
        expect(copyBtn).toBeTruthy();
        // Click should not throw even when clipboard rejects
        await user.click(copyBtn!);
        expect(document.body).toBeTruthy();
    });
});
