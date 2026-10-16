import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import {
    BarList, bucketLabel, Delta, formatRate, Hero, hoursTooltip, hourTick, LEGEND_PROPS, mondayOf, previousLabel,
    StatTile, stopRowClick, tokenTick, tokenTooltip, usdTick, usdTooltip,
} from './_chrome.js';

describe('analytics chrome helpers', () => {
    it('mondayOf matches Postgres date_trunc(week)', () => {
        expect(mondayOf('2026-10-16')).toBe('2026-10-12');
        expect(mondayOf('2026-10-12')).toBe('2026-10-12');
        expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    });

    it('formats buckets, rates and the comparison label', () => {
        expect(bucketLabel('2026-10-05')).toMatch(/Oct\s*5|5\s*Oct/);
        expect(bucketLabel('nope')).toBe('nope');
        expect(formatRate(null)).toBe('—');
        expect(formatRate(0.856)).toBe('86%');
        expect(previousLabel('month')).toBe('vs the same days last month');
        expect(previousLabel('7d')).toBe('vs the 7 days before');
    });

    it('Delta says which way and whether it is good news', () => {
        const { rerender } = renderWithProviders(<Delta cur={12} prev={10} goodWhen="up" />);
        expect(screen.getByText(/up 20/)).toBeInTheDocument();
        rerender(<Delta cur={0.9} prev={0.8} goodWhen="up" points />);
        expect(screen.getByText(/up 10/)).toHaveTextContent('pts');
        rerender(<Delta cur={5} prev={null} goodWhen="down" />);
        expect(screen.getByText('no earlier data')).toBeInTheDocument();
        rerender(<Delta cur={5} prev={0} goodWhen="down" />);
        expect(screen.getByText('none before')).toBeInTheDocument();
        rerender(<Delta cur={0} prev={0} goodWhen="down" />);
        expect(screen.getByText('same as before')).toBeInTheDocument();
        rerender(<Delta cur={10} prev={10} goodWhen="down" />);
        expect(screen.getByText('same as before')).toBeInTheDocument();
    });

    it('StatTile exposes its definition through a labelled button', () => {
        renderWithProviders(<StatTile label="Lead time" value="3.0h" definition="created → first Done" caption="p90 9h" />);
        expect(screen.getByRole('button', { name: 'How Lead time is measured' })).toBeInTheDocument();
        expect(screen.getByText('p90 9h')).toBeInTheDocument();
    });

    it('BarList prints every value and survives an all-zero list', () => {
        renderWithProviders(
            <BarList label="L" rows={[{ key: 'a', label: 'A', value: 0, display: '0', note: 'n' }, { key: 'b', label: 'B', value: 0, display: '0' }]} />,
        );
        expect(screen.getByRole('list', { name: 'L' })).toBeInTheDocument();
        expect(screen.getAllByText('0')).toHaveLength(2);
    });

    it('Hero takes a non-h1 title so a page keeps one h1', () => {
        renderWithProviders(<Hero breadcrumb={null} title="Insight" titleComponent="h2" />);
        expect(screen.getByRole('heading', { level: 2, name: 'Insight' })).toBeInTheDocument();
    });

    it('chart formatters print units the way the tiles do', () => {
        expect(usdTick(12)).toBe('$12');
        expect(hourTick(4)).toBe('4h');
        expect(tokenTick(1_500_000)).toBe(tokenTooltip('1500000'));
        expect(usdTooltip('2.5')).toBe('$2.50');
        expect(hoursTooltip(1.5)).toBe('1.5h');
        let stopped = false;
        stopRowClick({ stopPropagation: () => (stopped = true) });
        expect(stopped).toBe(true);
        renderWithProviders(<>{LEGEND_PROPS.formatter('Agent runs')}</>);
        expect(screen.getByText('Agent runs')).toBeInTheDocument();
    });
});
