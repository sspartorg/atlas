import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { InlineRuleText } from './InlineRuleText.js';

describe('InlineRuleText', () => {
    it('renders plain text', () => {
        const { container } = renderWithProviders(<InlineRuleText text="hello world" />);
        expect(container.textContent).toContain('hello world');
    });

    it('renders backtick chunks as inline code', () => {
        const { container } = renderWithProviders(
            <InlineRuleText text="use `foo()` over `bar()`" />,
        );
        expect(container.querySelectorAll('code').length).toBe(2);
    });
});
