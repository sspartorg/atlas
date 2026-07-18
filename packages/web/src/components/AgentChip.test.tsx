import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { AgentChip } from './AgentChip.js';

describe('AgentChip', () => {
    it('renders the agent name and initial', () => {
        renderWithProviders(
            <AgentChip agent={{ name: 'Coder', accent_color: '#0A0A0A' }} />,
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('hides the name when showName is false', () => {
        renderWithProviders(
            <AgentChip agent={{ name: 'Coder', accent_color: '#0A0A0A' }} showName={false} size="xs" />,
        );
        expect(screen.queryByText('Coder')).not.toBeInTheDocument();
    });

    it('appends " · designation" after the name when designation is set', () => {
        renderWithProviders(
            <AgentChip
                agent={{ name: 'PO Writer', accent_color: '#0A0A0A', designation: 'Product Owner' }}
            />,
        );
        expect(screen.getByText('PO Writer · Product Owner')).toBeInTheDocument();
    });

    it('renders just the name when designation is empty or missing', () => {
        renderWithProviders(
            <AgentChip agent={{ name: 'Coder', accent_color: '#0A0A0A', designation: '' }} />,
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });

    it('renders name and designation on separate lines in stacked layout', () => {
        renderWithProviders(
            <AgentChip
                agent={{ name: 'PO Writer', accent_color: '#0A0A0A', designation: 'Product Owner' }}
                layout="stacked"
            />,
        );
        // Both texts present as their own elements (no inline dot separator).
        expect(screen.getByText('PO Writer')).toBeInTheDocument();
        expect(screen.getByText('Product Owner')).toBeInTheDocument();
        // No combined "Name · Designation" inline string in stacked mode.
        expect(screen.queryByText('PO Writer · Product Owner')).not.toBeInTheDocument();
    });

    it('falls back to inline name when stacked layout is set but designation is empty', () => {
        renderWithProviders(
            <AgentChip
                agent={{ name: 'Owner', accent_color: '#0A0A0A', designation: '' }}
                layout="stacked"
            />,
        );
        expect(screen.getByText('Owner')).toBeInTheDocument();
    });
});
