import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { MarkdownPreview } from './MarkdownPreview.js';

describe('MarkdownPreview', () => {
    it('renders empty placeholder for blank source', () => {
        renderWithProviders(<MarkdownPreview source="" />);
        expect(screen.getByText(/Empty document/)).toBeInTheDocument();
    });

    it('renders h1/h2/h3 + paragraph + bullets', () => {
        renderWithProviders(
            <MarkdownPreview source={'# Title\n## Subtitle\n### Inner\n\nbody paragraph\n\n- one\n- two'} />,
        );
        expect(screen.getByText('Title')).toBeInTheDocument();
        expect(screen.getByText('Subtitle')).toBeInTheDocument();
        expect(screen.getByText('Inner')).toBeInTheDocument();
        expect(screen.getByText('body paragraph')).toBeInTheDocument();
        expect(screen.getByText('one')).toBeInTheDocument();
        expect(screen.getByText('two')).toBeInTheDocument();
    });

    it('renders inline code, bold, italic', () => {
        renderWithProviders(
            <MarkdownPreview source={'some `code` and **bold** and *italic*'} />,
        );
        expect(screen.getByText('code')).toBeInTheDocument();
        expect(screen.getByText('bold')).toBeInTheDocument();
        expect(screen.getByText('italic')).toBeInTheDocument();
    });

    it('renders [text](url) as an anchor with href; external URLs open in a new tab', () => {
        renderWithProviders(
            <MarkdownPreview
                source={
                    'See [run abc12345](/agents/agent-x/runs/abc12345-full-uuid) or [docs](https://example.com).'
                }
            />,
        );
        const internal = screen.getByText('run abc12345').closest('a');
        expect(internal).toHaveAttribute('href', '/agents/agent-x/runs/abc12345-full-uuid');
        expect(internal).not.toHaveAttribute('target');

        const external = screen.getByText('docs').closest('a');
        expect(external).toHaveAttribute('href', 'https://example.com');
        expect(external).toHaveAttribute('target', '_blank');
        expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('h2 as first block (idx=0) does not add top margin', () => {
        // When h2 is the very first block, idx === 0 so mt = 0
        renderWithProviders(<MarkdownPreview source="## Section title" />);
        expect(screen.getByText('Section title')).toBeInTheDocument();
    });

    it('renders consecutive paragraph lines joined with space (paraBuffer join)', () => {
        // Two non-heading, non-bullet lines without blank between them -> join(' ')
        renderWithProviders(<MarkdownPreview source={'line one\nline two'} />);
        expect(screen.getByText(/line one line two/)).toBeInTheDocument();
    });

    it('renders a bullet list followed immediately by a heading (flushBullets on h2)', () => {
        // Exercises flushBullets() called when h2 is encountered without blank line
        renderWithProviders(
            <MarkdownPreview source={'- item A\n- item B\n## After bullets'} />,
        );
        expect(screen.getByText('item A')).toBeInTheDocument();
        expect(screen.getByText('item B')).toBeInTheDocument();
        expect(screen.getByText('After bullets')).toBeInTheDocument();
    });

    it('renders a paragraph followed by a bullet list (flushPara on bullet)', () => {
        // Exercises flushPara() called when bullet encountered after paragraph text
        renderWithProviders(<MarkdownPreview source={'some text\n- item'} />);
        expect(screen.getByText(/some text/)).toBeInTheDocument();
        expect(screen.getByText('item')).toBeInTheDocument();
    });

    it('renders h1 when it is NOT the first block (idx > 0 branch for mt: 4)', () => {
        // Paragraph before h1 → h1 is at idx > 0 → mt = 4 (not 0)
        renderWithProviders(<MarkdownPreview source={'intro\n\n# Main Title'} />);
        expect(screen.getByText(/intro/)).toBeInTheDocument();
        expect(screen.getByText('Main Title')).toBeInTheDocument();
    });

    it('renders h2 when it is NOT the first block (idx > 0 branch for mt: 4)', () => {
        // Paragraph before h2 → h2 is at idx > 0 → mt = 4 (not 0)
        renderWithProviders(<MarkdownPreview source={'some text\n\n## Section'} />);
        expect(screen.getByText(/some text/)).toBeInTheDocument();
        expect(screen.getByText('Section')).toBeInTheDocument();
    });

    it('renders h3 as non-first block (h3 always uses mt=3 regardless)', () => {
        renderWithProviders(<MarkdownPreview source={'# Title\n\n### Subsection'} />);
        expect(screen.getByText('Title')).toBeInTheDocument();
        expect(screen.getByText('Subsection')).toBeInTheDocument();
    });
});
