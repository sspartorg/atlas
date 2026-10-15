import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { makeAgent } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import {
    ACTIONS,
    AgentRoom,
    blocked,
    clearPath,
    coffeeQueue,
    hallOf,
    lineUp,
    ring,
    route,
} from './AgentRoom.js';

function runs(list: Array<{ agent_id: string; status: string }>) {
    server.use(http.get('http://localhost:3000/api/run', () => HttpResponse.json(list)));
}

// jsdom has no layout: give the room a size so robots get placed.
function roomSize(w: number, h: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(h);
}

afterEach(() => vi.restoreAllMocks());

describe('AgentRoom', () => {
    it('draws one robot link per active agent', async () => {
        runs([{ agent_id: 'a2', status: 'in_progress' }]);
        roomSize(600, 300);
        renderWithProviders(
            <AgentRoom
                agents={[
                    makeAgent({ id: 'a1', name: 'Coder', category: 'software-dev' }),
                    makeAgent({ id: 'a2', name: 'Writer', category: 'content' }),
                    makeAgent({ id: 'a3', name: 'Retired', status: 'inactive' }),
                ]}
            />
        );
        expect(screen.getByRole('link', { name: 'Coder' })).toHaveAttribute('href', '/agents/a1');
        expect(await screen.findByRole('link', { name: 'Writer (working)' })).toHaveAttribute(
            'href',
            '/agents/a2'
        );
        expect(screen.queryByRole('link', { name: /Retired/ })).not.toBeInTheDocument();
    });

    it('points to the Marketplace when there are no active agents', () => {
        runs([]);
        renderWithProviders(<AgentRoom agents={[]} />);
        expect(
            screen.getByRole('link', { name: 'Install agents from the Marketplace' })
        ).toHaveAttribute('href', '/agents/marketplace');
        expect(screen.queryByRole('button', { name: 'Fun action' })).not.toBeInTheDocument();
    });

    it('runs a random fun action and never repeats it back to back', async () => {
        runs([]);
        roomSize(600, 300);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        renderWithProviders(
            <AgentRoom
                agents={[makeAgent({ id: 'a1', name: 'A' }), makeAgent({ id: 'a2', name: 'B' })]}
            />
        );
        const button = screen.getByRole('button', { name: 'Fun action' });
        await userEvent.click(button);
        expect(screen.getByRole('status')).toHaveTextContent('Soldiers, rotate your heads!');
        await userEvent.click(button);
        expect(screen.getByRole('status')).toHaveTextContent('Avengers, assemble!');
    });

    it.each(ACTIONS.map((a, i) => [a.caption, i] as const))('runs "%s"', (caption, i) => {
        runs([]);
        roomSize(1000, 480);
        vi.spyOn(Math, 'random').mockReturnValue((i + 0.5) / ACTIONS.length);
        renderWithProviders(
            <AgentRoom
                agents={[makeAgent({ id: 'a1', name: 'A' }), makeAgent({ id: 'a2', name: 'B' })]}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Fun action' }));
        expect(screen.getByRole('status')).toHaveTextContent(caption);
    });

    it.each([
        ['a phone', 300, 360, 8],
        ['a wide screen', 1000, 480, 22],
    ])('on %s (%i×%i px), %i robots perform actions', (_, w, h, performers) => {
        runs([]);
        roomSize(w, h);
        const { container } = renderWithProviders(
            <AgentRoom
                agents={Array.from({ length: 22 }, (_, i) =>
                    makeAgent({ id: `a${i}`, name: `Agent ${i}` })
                )}
            />
        );
        // Robots carry their name as a tooltip; the icon links don't.
        expect(container.querySelectorAll('a[title]')).toHaveLength(22);
        expect(container.querySelectorAll('.bot-perform')).toHaveLength(performers);
    });

    it('does not repeat the last action after it has finished', () => {
        runs([]);
        roomSize(600, 300);
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        renderWithProviders(
            <AgentRoom
                agents={[makeAgent({ id: 'a1', name: 'A' }), makeAgent({ id: 'a2', name: 'B' })]}
            />
        );
        const button = screen.getByRole('button', { name: 'Fun action' });
        fireEvent.click(button);
        act(() => vi.advanceTimersByTime(7000));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.getByRole('status')).toHaveTextContent('Avengers, assemble!');
        vi.useRealTimers();
    });
});

describe('hall layout', () => {
    it('lines up in the open floor, never in the furniture', () => {
        for (const [w, h, n] of [
            [1000, 480, 22],
            [1000, 480, 40],
            [300, 360, 22],
        ] as const) {
            const hall = hallOf(w, h);
            for (const s of lineUp(n, hall)) expect(blocked(hall, s.x, s.y)).toBe(false);
        }
    });

    it('walks around the table instead of through it', () => {
        const hall = hallOf(1000, 480);
        const t = hall.furniture.find((f) => f.key === 'table')!.rect;
        const y = t.y + t.h / 2 - hall.bh * 0.9;
        const from = { x: t.x - hall.bw * 1.5, y, left: false, ms: 3000 };
        const to = { x: t.x + t.w + hall.bw * 0.5, y, left: false, ms: 3000 };
        expect(clearPath(hall, from, to)).toBe(false);
        // Follow the legs: each one clear, all of them taking the walk's time.
        let at = from;
        let leg = route(hall, from, to);
        let ms = 0;
        let legs = 0;
        while (leg) {
            expect(clearPath(hall, at, leg)).toBe(true);
            ms += leg.ms;
            legs++;
            at = leg;
            leg = leg.then ?? null;
        }
        expect(legs).toBeGreaterThan(1);
        expect(at).toMatchObject({ x: to.x, y: to.y });
        expect(ms).toBeCloseTo(3000);
    });

    it('never lets a robot stand behind the bookshelf', () => {
        const hall = hallOf(1000, 480);
        const shelf = hall.furniture.find((f) => f.key === 'shelf')!.rect;
        // Feet level with the shelf, just left of it: only its arm overlaps.
        const y = shelf.y + shelf.h - 4 - hall.bh;
        expect(blocked(hall, shelf.x - hall.bw * 0.8, y)).toBe(true);
        // Clear of its edge, or standing in front of it, is fine.
        expect(blocked(hall, shelf.x - hall.bw - 2, y)).toBe(false);
        expect(blocked(hall, shelf.x, shelf.y + shelf.h + hall.bh * 0.25 - hall.bh)).toBe(false);
    });

    it('crowds the coffee counter without anyone in or behind the furniture', () => {
        for (const [w, h] of [
            [1000, 480],
            [300, 360],
        ] as const) {
            const hall = hallOf(w, h);
            for (const s of coffeeQueue(30, hall)) expect(blocked(hall, s.x, s.y)).toBe(false);
        }
    });

    it('finds a clear way between any two free spots, phone to desktop', () => {
        for (const [w, h] of [
            [302, 360],
            [700, 480],
            [1000, 480],
        ] as const) {
            const hall = hallOf(w, h);
            const free = () => {
                for (;;) {
                    const x = Math.random() * (w - hall.bw);
                    const y = hall.top + Math.random() * (h - hall.bh - hall.top);
                    if (!blocked(hall, x, y)) return { x, y, left: false, ms: 1000 };
                }
            };
            for (let i = 0; i < 300; i++) {
                const from = free();
                const to = free();
                let at = from;
                let leg = route(hall, from, to);
                expect(leg).not.toBeNull();
                while (leg) {
                    expect(clearPath(hall, at, leg)).toBe(true);
                    at = leg;
                    leg = leg.then ?? null;
                }
                expect(at).toMatchObject({ x: to.x, y: to.y });
            }
        }
    });

    it('rings the table without anyone standing in it', () => {
        for (const [w, h] of [
            [1000, 480],
            [300, 360],
        ] as const) {
            const hall = hallOf(w, h);
            for (const s of ring(22, hall)) expect(blocked(hall, s.x, s.y)).toBe(false);
        }
    });

    it('centres one line-up row and wraps when the hall is narrow', () => {
        const wide = hallOf(1000, 480);
        const one = lineUp(2, wide);
        expect(one[0]!.y).toBe(one[1]!.y);
        expect(one[0]!.x).toBe((1000 - 56 - 56) / 2);
        const narrow = hallOf(100, 480);
        expect(new Set(lineUp(5, narrow).map((s) => s.y)).size).toBeGreaterThan(1);
    });

    it('fits a crowd in a phone-sized hall, on the floor', () => {
        const hall = hallOf(300, 360);
        for (const s of lineUp(40, hall)) {
            expect(s.y).toBeGreaterThanOrEqual(hall.top);
            expect(s.y + hall.bh).toBeLessThanOrEqual(360 + 1);
            expect(s.x).toBeGreaterThanOrEqual(-1);
            expect(s.x + hall.bw).toBeLessThanOrEqual(300 + 1);
        }
    });

    it('keeps robots out of the furniture and rings the table', () => {
        const hall = hallOf(1000, 480);
        // The meeting table sits around the middle of the floor.
        expect(blocked(hall, 500 - hall.bw / 2, 0.66 * 480 - hall.bh)).toBe(true);
        expect(blocked(hall, 260, 0.5 * 480)).toBe(false);
        for (const s of ring(12, hall)) {
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.y).toBeGreaterThanOrEqual(hall.top);
            expect(s.y + hall.bh).toBeLessThanOrEqual(480);
        }
    });
});
