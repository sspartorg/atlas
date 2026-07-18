import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { GuardrailSeverityChip } from './GuardrailSeverityChip.js';

describe('GuardrailSeverityChip', () => {
    it.each(['block', 'ask_owner', 'warn'] as const)('renders the %s severity', (sev) => {
        renderWithProviders(<GuardrailSeverityChip severity={sev} />);
        expect(document.body.textContent?.length).toBeGreaterThan(0);
    });

    it('renders the md size', () => {
        renderWithProviders(<GuardrailSeverityChip severity="block" size="md" />);
        expect(document.body.textContent?.length).toBeGreaterThan(0);
    });
});
