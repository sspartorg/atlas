import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiUsagePanel } from './AiUsagePanel.js';

describe('AiUsagePanel', () => {
    it('renders nothing when total_cost_usd is null (AUP-HIDE)', () => {
        // Copilot interactive sessions (no per-event usage) leave all
        // five columns null; panel should disappear, not show $0.00.
        const { container } = render(
            <AiUsagePanel
                total_cost_usd={null}
                input_tokens={null}
                output_tokens={null}
                cache_creation_tokens={null}
                cache_read_tokens={null}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders all four rows when cost is set (AUP-RENDER)', () => {
        render(
            <AiUsagePanel
                total_cost_usd={0.1234}
                input_tokens={1_000}
                output_tokens={2_000}
                cache_creation_tokens={5_000}
                cache_read_tokens={10_000}
            />,
        );
        expect(screen.getByText('AI Usage')).toBeInTheDocument();
        expect(screen.getByText('Cost')).toBeInTheDocument();
        expect(screen.getByText('Context')).toBeInTheDocument();
        expect(screen.getByText('Output')).toBeInTheDocument();
        expect(screen.getByText('Cache created')).toBeInTheDocument();
        // Context value = input + cache_read = 11_000. formatTokenCount
        // shows "11K" (or similar). Assert the row exists rather than
        // hard-coding the exact label so a future formatter tweak doesn't
        // break the test for a cosmetic reason.
        expect(screen.getByText(/new ·/)).toBeInTheDocument();
        expect(screen.getByText(/cached/)).toBeInTheDocument();
    });

    it('handles a small but non-null cost (AUP-SMALL)', () => {
        // A real claude PTY session with 100 input tokens runs about
        // $0.0001 on haiku-4-5. The panel must still render — the gate
        // is `total_cost_usd == null`, not `total_cost_usd > 0`.
        const { container } = render(
            <AiUsagePanel
                total_cost_usd={0.0001}
                input_tokens={100}
                output_tokens={0}
                cache_creation_tokens={0}
                cache_read_tokens={0}
            />,
        );
        expect(container.firstChild).not.toBeNull();
        expect(screen.getByText('AI Usage')).toBeInTheDocument();
    });
});
