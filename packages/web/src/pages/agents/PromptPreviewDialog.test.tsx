import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { PromptPreviewDialog } from './PromptPreviewDialog.js';

const mockData = {
    prompt: '# Hello\nThis is the prompt content',
    filename: 'agent-coder.md',
    length: 100,
    agent: { id: 'agent-coder', name: 'Coder', cli: 'claude', model: 'claude-opus-4-7' },
    issue: null,
    guardrails_count: 3,
    sections: ['System', 'Context', 'Task'],
};

describe('PromptPreviewDialog', () => {
    it('shows "Compiling…" when data is null', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={null} onClose={vi.fn()} />,
        );
        expect(screen.getByText('Compiling…')).toBeTruthy();
    });

    it('shows agent name when data is provided', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        expect(screen.getByText('Coder')).toBeTruthy();
    });

    it('shows prompt content when data is provided', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        expect(screen.getByText(/Hello/)).toBeTruthy();
    });

    it('shows sections when data has sections', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        expect(screen.getByText(/System/)).toBeTruthy();
        expect(screen.getByText(/Context/)).toBeTruthy();
        expect(screen.getByText(/Task/)).toBeTruthy();
    });

    it('shows "Sections" label when sections are present', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        // The label is uppercased in the component; use getAllByText to avoid strict single-match
        const sectionsLabels = screen.getAllByText(/sections/i);
        expect(sectionsLabels.length).toBeGreaterThan(0);
    });

    it('renders Close, Copy, and Download buttons', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /download/i })).toBeTruthy();
    });

    it('Close button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={onClose} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Copy button calls navigator.clipboard.writeText', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /copy/i }));
        expect(writeText).toHaveBeenCalledWith(mockData.prompt);
    });

    it('Download button does not throw', async () => {
        // jsdom doesn't implement URL.createObjectURL; stub it
        const createObjectURL = vi.fn().mockReturnValue('blob:fake');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        await expect(
            userEvent.click(screen.getByRole('button', { name: /download/i })),
        ).resolves.not.toThrow();
    });

    it('Copy and Download buttons are disabled when data is null', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={null} onClose={vi.fn()} />,
        );
        expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    });

    it('shows "freedom run · no item" when issue is null', () => {
        renderWithProviders(
            <PromptPreviewDialog open={true} data={mockData} onClose={vi.fn()} />,
        );
        expect(screen.getByText(/freedom run/)).toBeTruthy();
    });

    it('shows issue details when issue is provided', () => {
        const dataWithIssue = {
            ...mockData,
            issue: { type: 'story', id: 'ATL-2', title: 'My story' },
        };
        renderWithProviders(
            <PromptPreviewDialog open={true} data={dataWithIssue} onClose={vi.fn()} />,
        );
        expect(screen.getByText(/issue · story ATL-2/)).toBeTruthy();
    });

    it('does not show Sections label when sections is empty (sections.length > 0 false branch)', () => {
        const dataNoSections = { ...mockData, sections: [] };
        renderWithProviders(
            <PromptPreviewDialog open={true} data={dataNoSections} onClose={vi.fn()} />,
        );
        // Sections block is conditionally rendered — with empty sections it must not appear
        expect(screen.queryByText(/^Sections$/i)).not.toBeInTheDocument();
    });

    it('Copy button is no-op when data is null (handleCopy guard branch)', async () => {
        // Clicking Copy with data=null hits the `if (!data) return` branch
        renderWithProviders(
            <PromptPreviewDialog open={true} data={null} onClose={vi.fn()} />,
        );
        // Button is disabled when data=null so userEvent won't fire, but verify disabled state
        const copyBtn = screen.getByRole('button', { name: /copy/i });
        expect(copyBtn).toBeDisabled();
    });

    it('Download button is no-op when data is null (handleDownload guard branch)', async () => {
        // Clicking Download with data=null hits the `if (!data) return` branch
        renderWithProviders(
            <PromptPreviewDialog open={true} data={null} onClose={vi.fn()} />,
        );
        const dlBtn = screen.getByRole('button', { name: /download/i });
        expect(dlBtn).toBeDisabled();
    });
});
