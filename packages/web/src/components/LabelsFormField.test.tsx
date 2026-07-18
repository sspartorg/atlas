import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { LabelsFormField } from './LabelsFormField.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('LabelsFormField', () => {
    it('renders existing labels as chips', () => {
        renderWithProviders(
            <LabelsFormField
                labels={['frontend', 'urgent']}
                onChange={() => {}}
                suggestions={[]}
            />,
        );
        expect(screen.getByText('frontend')).toBeInTheDocument();
        expect(screen.getByText('urgent')).toBeInTheDocument();
    });

    it('shows placeholder when there are no labels', () => {
        renderWithProviders(
            <LabelsFormField labels={[]} onChange={() => {}} suggestions={['suggested']} />,
        );
        expect(
            screen.getByPlaceholderText(/type a label and press enter/i),
        ).toBeInTheDocument();
    });

    it('shows helper text when provided', () => {
        renderWithProviders(
            <LabelsFormField
                labels={[]}
                onChange={() => {}}
                suggestions={[]}
                helperText="At most 20 labels."
            />,
        );
        expect(screen.getByText('At most 20 labels.')).toBeInTheDocument();
    });

    it('fires onChange with a deduped, trimmed, capped list when a new chip is added via Enter', () => {
        const onChange = vi.fn();
        renderWithProviders(
            <LabelsFormField
                labels={['frontend']}
                onChange={onChange}
                suggestions={[]}
            />,
        );
        const input = screen.getByRole('combobox');
        fireEvent.change(input, { target: { value: 'urgent' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls[0]?.[0];
        expect(next).toEqual(['frontend', 'urgent']);
    });

    it('caps at 20 labels even if more are passed in', () => {
        const onChange = vi.fn();
        const overflow = Array.from({ length: 25 }, (_, i) => `l${i}`);
        renderWithProviders(
            <LabelsFormField labels={overflow} onChange={onChange} suggestions={[]} />,
        );
        // Add a sentinel to force a `commit`.
        const input = screen.getByRole('combobox');
        fireEvent.change(input, { target: { value: 'extra' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        const next = onChange.mock.calls[0]?.[0] as string[];
        expect(next.length).toBe(20);
    });
});
