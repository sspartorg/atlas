import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { QueueLiveLog } from './QueueLiveLog.js';

describe('QueueLiveLog', () => {
    it('renders "Waiting for output…" when live and no lines', () => {
        renderWithProviders(<QueueLiveLog lines={[]} isLive accent="#31AB46" />);
        expect(screen.getByText('Waiting for output…')).toBeInTheDocument();
    });

    it('renders "No output recorded." when not live and no lines', () => {
        renderWithProviders(<QueueLiveLog lines={[]} isLive={false} accent="#31AB46" />);
        expect(screen.getByText('No output recorded.')).toBeInTheDocument();
    });

    it('renders log lines when provided', () => {
        renderWithProviders(
            <QueueLiveLog
                lines={['line one', 'line two', 'line three']}
                isLive
                accent="#31AB46"
            />,
        );
        expect(screen.getByText(/line one/)).toBeInTheDocument();
        expect(screen.getByText(/line two/)).toBeInTheDocument();
    });

    it('renders "live · agent_output" label when live', () => {
        renderWithProviders(<QueueLiveLog lines={['hello']} isLive accent="#31AB46" />);
        expect(screen.getByText('live · agent_output')).toBeInTheDocument();
    });

    it('renders "final · no new lines" label when not live', () => {
        renderWithProviders(<QueueLiveLog lines={['hello']} isLive={false} accent="#31AB46" />);
        expect(screen.getByText('final · no new lines')).toBeInTheDocument();
    });

    it('renders correctly when lines is empty and not live', () => {
        renderWithProviders(<QueueLiveLog lines={[]} isLive={false} accent="#FF0000" />);
        expect(screen.getByText('No output recorded.')).toBeInTheDocument();
    });
});
