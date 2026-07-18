import { describe, expect, it } from 'vitest';
import type { ApiErrorKind } from '@atlas/shared';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { AtlasApiError } from '../api/api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

// W4 -- Per-kind copy snapshot. Each kind should produce a distinct,
// actionable title; covers the four "must work" kinds from the plan plus
// a few back-compat ones the global setErrorHandler emits. Keep the
// expectations on title substrings (not exact strings) so wording can
// evolve without churning the test on every nudge.
const TITLE_FOR: Record<ApiErrorKind, RegExp> = {
    credentials_missing: /Credentials not configured/i,
    credentials_invalid: /Credentials aren['']t working/i,
    rate_limited: /Rate-limited/i,
    upstream_unavailable: /Can['']t reach upstream/i,
    cli_not_installed: /CLI isn['']t on your PATH/i,
    unauthorized: /MCP token mismatch/i,
    not_found: /Not found/i,
    conflict: /Conflict/i,
    validation_error: /Invalid input/i,
    internal_error: /Something went wrong/i,
};

describe('ApiErrorAlert', () => {
    it.each(Object.keys(TITLE_FOR) as ApiErrorKind[])(
        'renders kind-aware copy for kind=%s',
        (kind) => {
            const err = new AtlasApiError(`upstream said: ${kind}`, kind, 400);
            const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
            const alert = getByRole('alert');
            expect(alert.textContent ?? '').toMatch(TITLE_FOR[kind]);
        },
    );

    it('falls back to String(error) for non-AtlasApiError throws', () => {
        const { getByRole } = renderWithProviders(
            <ApiErrorAlert error={new Error('network down')} />,
        );
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/network down/);
    });

    it('handles a bare string error', () => {
        const { getByRole } = renderWithProviders(<ApiErrorAlert error="legacy text" />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/legacy text/);
    });

    it('renders the contextLabel prefix when provided', () => {
        const err = new AtlasApiError('boom', 'not_found', 404);
        const { getByRole } = renderWithProviders(
            <ApiErrorAlert error={err} contextLabel="Couldn't load" />,
        );
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Couldn['']t load/);
    });

    it('surfaces the binary name in cli_not_installed copy from details', () => {
        const err = new AtlasApiError('ENOENT', 'cli_not_installed', 0, { binary: 'claude' });
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/claude CLI isn['']t on your PATH/);
    });

    it('falls back to agent CLI when no binary in cli_not_installed details', () => {
        const err = new AtlasApiError('ENOENT', 'cli_not_installed', 0, {});
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Agent CLI isn['']t on your PATH/);
    });

    it('falls back to agent CLI when details.binary is present but not a string', () => {
        // detailsBinary()'s inner `if (typeof b === 'string') return b;` is
        // false here (binary is a number), so it falls through to `return null`
        // — distinct from the `{}` case above where 'binary' isn't in details
        // at all (outer condition false).
        const err = new AtlasApiError('ENOENT', 'cli_not_installed', 0, { binary: 123 });
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Agent CLI isn['']t on your PATH/);
    });

    it('renders null error as Unknown error', () => {
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={null} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Unknown error/);
    });

    it('renders contextLabel prefix for non-AtlasApiError', () => {
        const { getByRole } = renderWithProviders(
            <ApiErrorAlert error={new Error('boom')} contextLabel="Load failed" />,
        );
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Load failed: /);
    });

    it('renders actionSlot when cta is undefined', () => {
        const err = new AtlasApiError('too many', 'rate_limited', 429);
        const { getByTestId } = renderWithProviders(
            <ApiErrorAlert error={err} actionSlot={<button data-testid="custom-action">Retry</button>} />,
        );
        expect(getByTestId('custom-action')).toBeInTheDocument();
    });

    it('omits the trailing upstream text for rate_limited when message is empty (falsy fallback)', () => {
        const err = new AtlasApiError('', 'rate_limited', 429);
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        // `'Wait a minute and retry. ' + (message || '')` — empty message
        // falls back to '', so the detail ends right after "retry. ".
        expect(alert.textContent ?? '').toMatch(/Wait a minute and retry\.\s*$/);
    });

    it('falls back to the generic copy for not_found when message is empty', () => {
        const err = new AtlasApiError('', 'not_found', 404);
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/The resource is gone\./);
    });

    it('falls back to the generic copy for conflict when message is empty', () => {
        const err = new AtlasApiError('', 'conflict', 409);
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/The request conflicts with current state\./);
    });

    it('falls back to the generic copy for validation_error when message is empty', () => {
        const err = new AtlasApiError('', 'validation_error', 422);
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/The request didn['']t parse\./);
    });

    it('falls back to the generic copy for internal_error when message is empty', () => {
        const err = new AtlasApiError('', 'internal_error', 500);
        const { getByRole } = renderWithProviders(<ApiErrorAlert error={err} />);
        const alert = getByRole('alert');
        expect(alert.textContent ?? '').toMatch(/Unexpected error\./);
    });
});
