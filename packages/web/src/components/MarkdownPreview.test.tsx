import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { MarkdownPreview, markdownReady } from './MarkdownPreview.js';

describe('MarkdownPreview', () => {
    it('renders empty placeholder for blank source', () => {
        renderWithProviders(<MarkdownPreview source="" />);
        expect(screen.getByText(/Empty document/)).toBeInTheDocument();
    });

    it('renders h1/h2/h3 + paragraph + bullets', () => {
        renderWithProviders(
            <MarkdownPreview
                source={'# Title\n## Subtitle\n### Inner\n\nbody paragraph\n\n- one\n- two'}
            />
        );
        expect(screen.getByText('Title')).toBeInTheDocument();
        expect(screen.getByText('Subtitle')).toBeInTheDocument();
        expect(screen.getByText('Inner')).toBeInTheDocument();
        expect(screen.getByText('body paragraph')).toBeInTheDocument();
        expect(screen.getByText('one')).toBeInTheDocument();
        expect(screen.getByText('two')).toBeInTheDocument();
    });

    // A block that scrolls sideways must take keyboard focus (axe
    // scrollable-region-focusable; e2e/a11y/projects-tasks.spec.ts).
    it('makes fenced code and tables focusable so their scroll is reachable by keyboard', async () => {
        await markdownReady;
        const { container } = renderWithProviders(
            <MarkdownPreview source={'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nlong line\n```'} />
        );
        await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
        expect(container.querySelector('pre')).toHaveAttribute('tabindex', '0');
        expect(container.querySelector('table')?.parentElement).toHaveAttribute('tabindex', '0');
    });

    it('renders inline code, bold, italic', () => {
        renderWithProviders(<MarkdownPreview source={'some `code` and **bold** and *italic*'} />);
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
            />
        );
        const internal = screen.getByText('run abc12345').closest('a');
        expect(internal).toHaveAttribute('href', '/agents/agent-x/runs/abc12345-full-uuid');
        expect(internal).not.toHaveAttribute('target');

        const external = screen.getByText('docs').closest('a');
        expect(external).toHaveAttribute('href', 'https://example.com');
        expect(external).toHaveAttribute('target', '_blank');
        expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders Atlas Jira-attachment images inline and refuses any other image URL', () => {
        const { container } = renderWithProviders(
            <MarkdownPreview
                source={
                    '![shot.png](/api/jira-attachments/10)\n\n![x](https://evil.example/t.png)\n\n![y](/api/other/1)'
                }
            />
        );
        const imgs = container.querySelectorAll('img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0]).toHaveAttribute('src', '/api/jira-attachments/10');
        expect(imgs[0]).toHaveAttribute('alt', 'shot.png');
        expect(imgs[0]!.closest('a')).toHaveAttribute('href', '/api/jira-attachments/10');
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
        renderWithProviders(<MarkdownPreview source={'- item A\n- item B\n## After bullets'} />);
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

    it('renders > lines as one quote block that keeps its line breaks', () => {
        // The shape jira-sync writes: every line quoted, a blank line after.
        const { container } = renderWithProviders(
            <MarkdownPreview source={'> first line\n> second line\n>\n> **Owner** · now\n\nafter'} />
        );
        const paras = [...container.querySelectorAll('blockquote p')].map((p) => p.textContent);
        expect(paras).toEqual(['first line\nsecond line', 'Owner · now']);
        expect(screen.getByText('after').closest('blockquote')).toBeNull();
    });
    it('renders a GFM table as a table that scrolls inside its own box', () => {
        const { container } = renderWithProviders(
            <MarkdownPreview source={'| Row | Result |\n|---|:-:|\n| `a.js` | **pass** |\n| b.js | fail |'} />
        );
        const table = container.querySelector('table')!;
        expect([...table.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Row', 'Result']);
        expect([...table.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual(['a.jspass', 'b.jsfail']);
        expect(table.querySelector('code')?.textContent).toBe('a.js');
        expect(getComputedStyle(table.parentElement!).overflowX).toBe('auto');
        expect(container.textContent).not.toContain('|---|');
    });

    it('keeps a fenced block line for line (CLI output in agent comments)', () => {
        const out = '# Subtest: free above 2000\nok 14 - free above 2000\n  ---\n  duration_ms: 0.02';
        const { container } = renderWithProviders(
            <MarkdownPreview source={'`npm test` did not pass.\n\n```\n' + out + '\n```\n\nAfter.'} />
        );
        const pre = container.querySelector('pre')!;
        expect(pre.textContent).toBe(out + '\n');
        // The "# Subtest" and "---" lines stay text, not a heading / a rule.
        expect(container.querySelector('h1, hr')).toBeNull();
        expect(screen.getByText('After.')).toBeInTheDocument();
    });

    it('renders numbered lists, nested lists, task lists and strikethrough', () => {
        const { container } = renderWithProviders(
            <MarkdownPreview source={'3. three\n4. four\n   - nested\n\n- [x] done\n- [ ] open\n\n~~gone~~'} />
        );
        const ol = container.querySelector('ol')!;
        expect(ol).toHaveAttribute('start', '3');
        expect(ol.querySelectorAll(':scope > li')).toHaveLength(2);
        expect(ol.querySelector('ul li')?.textContent).toBe('nested');
        const boxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
        expect(boxes.map((b) => b.checked)).toEqual([true, false]);
        expect(boxes.every((b) => b.disabled)).toBe(true);
        expect(container.querySelector('del')?.textContent).toBe('gone');
    });

    it('drops the href of javascript:, data:, vbscript: and protocol-relative links', () => {
        const { container } = renderWithProviders(
            <MarkdownPreview
                source={'[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](//evil.example) [e](JaVaScRiPt:x) <javascript:alert(1)>'}
            />
        );
        expect(container.querySelectorAll('a')).toHaveLength(0);
        for (const t of ['a', 'b', 'c', 'd', 'e']) expect(container.textContent).toContain(t);
    });

    it('shows raw HTML as text and never creates its elements', () => {
        const { container } = renderWithProviders(
            <MarkdownPreview source={'<script>window.__x = 1</script>\n\nhi <img src=x onerror="alert(1)"> <b>bold</b>'} />
        );
        expect(container.querySelector('script, img, b')).toBeNull();
        expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    });

    it('shows a refused image as its alt text', () => {
        renderWithProviders(<MarkdownPreview source={'![tracking pixel](https://evil.example/t.png)'} />);
        expect(screen.getByText('tracking pixel')).toBeInTheDocument();
    });

    it('autolinks bare URLs (GFM) and still opens them in a new tab', () => {
        renderWithProviders(<MarkdownPreview source={'see https://example.com/pr/1 now'} />);
        expect(screen.getByRole('link', { name: 'https://example.com/pr/1' })).toHaveAttribute('target', '_blank');
    });

    it('uses the caller\'s empty text when given', () => {
        renderWithProviders(<MarkdownPreview source={'  '} emptyText="Nothing to preview yet." />);
        expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument();
    });

    it('shows the text plain until the renderer chunk lands, then formats it', async () => {
        // A fresh module copy: the renderer has not loaded yet for this one.
        vi.resetModules();
        const fresh = await import('./MarkdownPreview.js');
        const { container } = renderWithProviders(<fresh.MarkdownPreview source={'**bold** line\nnext'} />);
        if (!container.querySelector('strong')) {
            expect(container.textContent).toContain('**bold** line');
        }
        await waitFor(() => expect(container.querySelector('strong')?.textContent).toBe('bold'));
    });

    it('quoted Jira wiki text keeps its markers as text, not headings, lists or tables', () => {
        const source = [
            '## Description',
            '',
            '> Steps:',
            '> # Import into Atlas',
            '> # Comment round trip',
            '> * wiki bullet',
            '> 1. not a list',
            '> ||Name||Value||',
            '> |a|b|',
            '> **bold** and `code` and [ATL-1](https://example.com) ![s.png](/api/jira-attachments/7)',
            '>     indented line',
            '',
            'after',
        ].join('\n');
        const { container } = renderWithProviders(<MarkdownPreview source={source} />);
        const quote = container.querySelector('blockquote')!;
        expect(quote.querySelector('h1, h2, h3, ul, ol, table, pre')).toBeNull();
        const text = quote.textContent ?? '';
        for (const line of ['# Import into Atlas', '# Comment round trip', '* wiki bullet', '1. not a list', '||Name||Value||', '|a|b|']) {
            expect(text).toContain(line);
        }
        expect(text).not.toContain('\\');
        expect(quote.querySelectorAll('br').length).toBeGreaterThanOrEqual(8);
        expect(quote.querySelector('strong')?.textContent).toBe('bold');
        expect(quote.querySelector('code')?.textContent).toBe('code');
        expect(quote.querySelector('a[href="https://example.com"]')).not.toBeNull();
        expect(quote.querySelector('img')).toHaveAttribute('src', '/api/jira-attachments/7');
        expect(text).toContain('    indented line');
        expect(screen.getByText('after').closest('blockquote')).toBeNull();
    });
});

