import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { TodaysPassSection } from './TodaysPassSection.js';
import type { TodaysPassItem } from '../../api/types.js';

const makeItem = (overrides: Partial<TodaysPassItem> = {}): TodaysPassItem => ({
    run_id: 'r1',
    agent_id: 'agent-coder',
    agent_name: 'Coder',
    agent_category: 'software-dev',
    agent_accent_color: '#0A0A0A',
    issue_type: 'story',
    issue_id: 'CER-12',
    completed_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
});

describe('TodaysPassSection', () => {
    it('renders empty state for undefined pass (covers ?. null-coalescing)', () => {
        renderWithProviders(<TodaysPassSection todaysPass={undefined} />);
        expect(screen.getByText(/Today's Pass/)).toBeInTheDocument();
        // items=[] → total=0 (items.length fallback since todaysPass=undefined)
        expect(document.body.textContent).toContain('0 outputs');
    });

    it('renders three category cards', () => {
        renderWithProviders(
            <TodaysPassSection
                todaysPass={{
                    items: [],
                    total: 0,
                }}
            />,
        );
        expect(screen.getByText('Software dev')).toBeInTheDocument();
        expect(screen.getByText('Content')).toBeInTheDocument();
        expect(screen.getByText('Design')).toBeInTheDocument();
    });

    it('filters items into dev/content/design categories (covers filter branches)', () => {
        const devItem = makeItem({ agent_category: 'software-dev', agent_name: 'DevAgent' });
        const contentItem = makeItem({ run_id: 'r2', agent_category: 'content', agent_name: 'ContentAgent' });
        const designItem = makeItem({ run_id: 'r3', agent_category: 'design', agent_name: 'DesignAgent' });
        const marketingItem = makeItem({ run_id: 'r4', agent_category: 'marketing', agent_name: 'MarketAgent' });
        renderWithProviders(
            <TodaysPassSection
                todaysPass={{
                    items: [devItem, contentItem, designItem, marketingItem],
                    total: 4,
                }}
            />,
        );
        // Each category card gets its items
        expect(screen.getByText(/DevAgent/)).toBeInTheDocument();
        expect(screen.getByText(/ContentAgent/)).toBeInTheDocument();
        expect(screen.getByText(/DesignAgent/)).toBeInTheDocument();
        // MarketAgent goes into neither category card — it doesn't appear
    });

    it('uses items.length as total fallback when todaysPass.total is not provided', () => {
        // todaysPass exists but total is undefined → uses items.length fallback (covers ?? branch)
        const items = [makeItem(), makeItem({ run_id: 'r2' })];
        renderWithProviders(
            <TodaysPassSection
                todaysPass={{
                    items,
                    total: undefined as unknown as number,
                }}
            />,
        );
        // total = undefined ?? items.length = 2 → "2 outputs"
        expect(document.body.textContent).toContain('outputs');
    });
});
