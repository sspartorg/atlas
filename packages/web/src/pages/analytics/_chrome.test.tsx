import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Card, ChartEmpty, Eyebrow, MetricMarquee, ChartTitle, Hero } from './_chrome.js';

describe('analytics chrome', () => {
    it('Eyebrow renders children', () => {
        renderWithProviders(<Eyebrow>OVERVIEW</Eyebrow>);
        expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    });

    it('Eyebrow accepts the light prop', () => {
        renderWithProviders(<Eyebrow light>NIGHT</Eyebrow>);
        expect(screen.getByText('NIGHT')).toBeInTheDocument();
    });

    it('Card wraps its children', () => {
        renderWithProviders(
            <Card>
                <span>child</span>
            </Card>,
        );
        expect(screen.getByText('child')).toBeInTheDocument();
    });

    it('ChartTitle renders eyebrow + title + optional sub', () => {
        renderWithProviders(
            <ChartTitle eyebrow="EY" title="My chart" sub="Subtext" />,
        );
        expect(screen.getByText('EY')).toBeInTheDocument();
        expect(screen.getByText('My chart')).toBeInTheDocument();
        expect(screen.getByText('Subtext')).toBeInTheDocument();
    });

    it('ChartTitle omits the sub paragraph when sub is undefined', () => {
        renderWithProviders(<ChartTitle eyebrow="EY" title="My chart" />);
        expect(screen.getByText('My chart')).toBeInTheDocument();
        expect(screen.queryByText('Subtext')).not.toBeInTheDocument();
    });

    it('MetricMarquee renders label + value + optional sub', () => {
        renderWithProviders(
            <MetricMarquee label="Cost" value="$1.23" sub="this month" accent="#fff" />,
        );
        expect(screen.getByText('Cost')).toBeInTheDocument();
        expect(screen.getByText('$1.23')).toBeInTheDocument();
        expect(screen.getByText('this month')).toBeInTheDocument();
    });

    it('MetricMarquee omits sub when undefined', () => {
        renderWithProviders(
            <MetricMarquee label="Cost" value="$1.23" accent="#fff" />,
        );
        expect(screen.queryByText('this month')).not.toBeInTheDocument();
    });

    it('Hero renders title, sub, breadcrumb, and children', () => {
        renderWithProviders(
            <Hero
                breadcrumb={<span>crumb</span>}
                title={<span>hero</span>}
                sub="some sub"
            >
                <div>marquee child</div>
            </Hero>,
        );
        expect(screen.getByText('crumb')).toBeInTheDocument();
        expect(screen.getByText('hero')).toBeInTheDocument();
        expect(screen.getByText('some sub')).toBeInTheDocument();
        expect(screen.getByText('marquee child')).toBeInTheDocument();
    });

    it('ChartEmpty renders the label and sub text', () => {
        renderWithProviders(
            <ChartEmpty label="No data" sub="Once a run completes it lands here." />,
        );
        expect(screen.getByText(/No data/i)).toBeInTheDocument();
        expect(
            screen.getByText(/Once a run completes it lands here./i),
        ).toBeInTheDocument();
    });

    it('Hero omits sub when undefined', () => {
        renderWithProviders(
            <Hero breadcrumb={<span>c</span>} title={<span>t</span>}>
                <div>k</div>
            </Hero>,
        );
        expect(screen.getByText('t')).toBeInTheDocument();
    });
});
