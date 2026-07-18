import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { StatusChip } from './StatusChip.js';

describe('StatusChip', () => {
    it.each([
        ['draft', 'Draft'],
        ['ready', 'Ready'],
        ['in_progress', 'In Progress'],
        ['waiting_for_info', 'Waiting for Info'],
        ['in_review', 'In Review'],
        ['done', 'Done'],
    ])('renders the canonical label for %s', (status, label) => {
        renderWithProviders(<StatusChip status={status} />);
        expect(screen.getByLabelText(label)).toBeInTheDocument();
    });

    it('falls back to raw status string for unknown values', () => {
        renderWithProviders(<StatusChip status="custom_status" />);
        expect(screen.getByText('custom_status')).toBeInTheDocument();
    });

    it('renders all sizes without crashing', () => {
        const { unmount } = renderWithProviders(<StatusChip status="draft" size="xs" />);
        unmount();
        const second = renderWithProviders(<StatusChip status="draft" size="sm" />);
        second.unmount();
        renderWithProviders(<StatusChip status="draft" size="md" />);
        expect(screen.getByLabelText('Draft')).toBeInTheDocument();
    });
});
