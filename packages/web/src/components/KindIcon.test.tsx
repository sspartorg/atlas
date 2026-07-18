import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { KindIcon } from './KindIcon.js';

describe('KindIcon', () => {
    it.each([
        ['epic', 'Epic'],
        ['story', 'Story'],
        ['bug', 'Bug'],
        ['sub_task', 'Sub-task'],
        ['sub_bug', 'Sub-bug'],
    ] as const)('renders the %s label', (kind, label) => {
        renderWithProviders(<KindIcon kind={kind} />);
        expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
});
