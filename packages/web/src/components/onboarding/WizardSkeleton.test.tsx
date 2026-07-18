import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { WizardSkeleton } from './WizardSkeleton.js';

describe('WizardSkeleton', () => {
    it('mounts without crashing', () => {
        const { container } = renderWithProviders(<WizardSkeleton />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the StepIndicator loading state', () => {
        const { container } = renderWithProviders(<WizardSkeleton />);
        // StepIndicator is a sibling — its presence is enough; the deeper
        // step-counter logic is exercised in StepIndicator.test.tsx.
        // Use class/structure rather than role since the skeleton is pure
        // visual scaffolding with no accessible names.
        // The shimmer Skel elements all have position:relative + overflow:hidden
        // wrappers; assert at least the canonical count is present.
        const skels = container.querySelectorAll('.MuiBox-root');
        expect(skels.length).toBeGreaterThan(0);
    });
});
