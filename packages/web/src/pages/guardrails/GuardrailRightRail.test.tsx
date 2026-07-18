import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { GuardrailRightRail } from './GuardrailRightRail.js';

describe('GuardrailRightRail', () => {
    it('renders without crashing', () => {
        const { container } = renderWithProviders(<GuardrailRightRail />);
        expect(container.firstChild).toBeInTheDocument();
    });
});
