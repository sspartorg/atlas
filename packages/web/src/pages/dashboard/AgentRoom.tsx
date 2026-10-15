import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ATLAS_PALETTE, ELEVATION, LABEL_COLORS } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';
import { useActiveRuns } from '../../hooks/useActiveRuns.js';
import { useThemeModeContext } from '../../hooks/useThemeModeContext.js';
import { CATEGORIES } from './categories.js';
import type { AgentSummary } from '../../api/types.js';

interface IAgentRoomProps {
    agents: AgentSummary[];
}

// Past this many the hall stops adding robots and says "+N" (as FleetStrip).
const MAX_ROBOTS = 40;
// A robot's box at full size; phones draw them at PHONE_SCALE.
const BOT_W = 56;
const BOT_H = 64;
const PHONE_SCALE = 0.7;
const isPhone = (w: number) => w < 600;
// On phones only this many robots perform an action's own moves (spin,
// jump, wave, snore); the rest stand by. Each moving part costs the
// main thread style work every frame, which old phones can't keep up with.
const PHONE_PERFORMERS = 8;
// Of a robot's box: the empty side margin around its drawing, and how deep
// its feet reach (it may stand this close in front of furniture).
const BODY_MARGIN = 0.1;
const FEET_DEPTH = 0.2;
const TICK_MS = 2500;
const ACTION_MS = 6000;
// The wall takes the top of the hall; robots walk on the floor below it.
const WALL = 0.24;

type ActionKey =
    'heads' | 'assemble' | 'jump' | 'meeting' | 'coffee_break' | 'moonwalk' | 'nap' | 'wave';

/** `still`: robots stop wandering while it runs. */
export const ACTIONS: ReadonlyArray<{ key: ActionKey; caption: string; still?: boolean }> = [
    { key: 'heads', caption: 'Soldiers, rotate your heads!' },
    { key: 'assemble', caption: 'Avengers, assemble!', still: true },
    { key: 'jump', caption: 'Everybody jump!', still: true },
    { key: 'meeting', caption: 'Stand-up meeting!', still: true },
    { key: 'coffee_break', caption: 'Coffee break!', still: true },
    { key: 'moonwalk', caption: 'Moonwalk!' },
    { key: 'nap', caption: 'Lights out, nap time!', still: true },
    { key: 'wave', caption: 'Say hi to the boss!', still: true },
];

// Each robot gets its own bright body colour (stable per agent); its chest
// badge keeps the category colour.
const BODY_COLORS = [
    '#F43F5E',
    '#F97316',
    '#EAB308',
    '#22C55E',
    '#14B8A6',
    '#06B6D4',
    '#3B82F6',
    '#6366F1',
    '#A855F7',
    '#EC4899',
];
function bodyColor(id: string) {
    let n = 0;
    for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return BODY_COLORS[n % BODY_COLORS.length]!;
}

const HALL = {
    light: {
        wall: '#E6EDF7',
        base: '#B9C6D8',
        floor: '#F4EADB',
        plank: '#E7D6BF',
        wood: '#C99A6B',
        woodDark: '#8E6440',
        frame: '#64748B',
        glass: '#BAE6FD',
        board: '#FFFFFF',
        fabric: '#6366F1',
        fabricDark: '#4F46E5',
        leaf: '#22C55E',
        leafDark: '#15803D',
        pot: '#C2410C',
        metal: '#334155',
        rug: '#FBCFE8',
        rugEdge: '#F472B6',
        ink: '#334155',
    },
    dark: {
        wall: '#1C2433',
        base: '#2E3A4F',
        floor: '#2A241F',
        plank: '#342C26',
        wood: '#7A5634',
        woodDark: '#563B23',
        frame: '#94A3B8',
        glass: '#0E3A55',
        board: '#E2E8F0',
        fabric: '#4338CA',
        fabricDark: '#3730A3',
        leaf: '#16A34A',
        leafDark: '#14532D',
        pot: '#9A3412',
        metal: '#0F172A',
        rug: '#4A1D3A',
        rugEdge: '#9D174D',
        ink: '#A8B5C8',
    },
};
type Hall = (typeof HALL)['light'];

/**
 * Furniture, placed as fractions of the hall: `x`/`w` of its width, `bottom`
 * (where it stands) of its height; its height follows from `aspect`. Pieces
 * with `solid` are walked around. A narrow (phone) hall uses `onPhone`
 * — `[x, w, bottom]`, or `null` to leave the piece out — so fewer, bigger
 * pieces still read next to the robots.
 */
interface Piece {
    key: string;
    x: number;
    w: number;
    bottom: number;
    aspect: number;
    solid?: boolean;
    /** On the wall: always behind robots. */
    wall?: boolean;
    onPhone?: [number, number, number] | null;
    draw: (c: Hall) => ReactNode;
}
const FURNITURE: ReadonlyArray<Piece> = [
    {
        key: 'window-l',
        onPhone: [0.04, 0.2, 0.19],
        x: 0.05,
        w: 0.11,
        bottom: 0.19,
        aspect: 0.7,
        wall: true,
        draw: Window,
    },
    {
        key: 'board',
        onPhone: [0.33, 0.34, 0.2],
        x: 0.36,
        w: 0.2,
        bottom: 0.2,
        aspect: 0.5,
        wall: true,
        draw: Whiteboard,
    },
    {
        key: 'window-r',
        onPhone: null,
        x: 0.62,
        w: 0.11,
        bottom: 0.19,
        aspect: 0.7,
        wall: true,
        draw: Window,
    },
    {
        key: 'clock',
        onPhone: [0.84, 0.08, 0.13],
        x: 0.88,
        w: 0.045,
        bottom: 0.14,
        aspect: 1,
        wall: true,
        draw: Clock,
    },
    {
        key: 'rug',
        onPhone: [0.08, 0.84, 0.82],
        x: 0.3,
        w: 0.4,
        bottom: 0.82,
        aspect: 0.3,
        wall: true,
        draw: Rug,
    },
    {
        key: 'sofa',
        onPhone: [0.02, 0.34, 0.32],
        x: 0.03,
        w: 0.17,
        bottom: 0.33,
        aspect: 0.42,
        solid: true,
        draw: Sofa,
    },
    {
        key: 'plant-l',
        onPhone: null,
        x: 0.21,
        w: 0.04,
        bottom: 0.31,
        aspect: 1.8,
        solid: true,
        draw: Plant,
    },
    {
        key: 'shelf',
        onPhone: [0.58, 0.14, 0.32],
        x: 0.75,
        w: 0.08,
        bottom: 0.32,
        aspect: 1.3,
        solid: true,
        draw: Shelf,
    },
    {
        key: 'counter',
        onPhone: [0.74, 0.24, 0.32],
        x: 0.84,
        w: 0.12,
        bottom: 0.33,
        aspect: 0.8,
        solid: true,
        draw: Coffee,
    },
    {
        key: 'table',
        onPhone: [0.22, 0.56, 0.68],
        x: 0.37,
        w: 0.26,
        bottom: 0.7,
        aspect: 0.38,
        solid: true,
        draw: Table,
    },
    {
        key: 'plant-r',
        onPhone: [0.03, 0.09, 0.97],
        x: 0.03,
        w: 0.045,
        bottom: 0.97,
        aspect: 1.8,
        solid: true,
        draw: Plant,
    },
    {
        key: 'beanbag',
        onPhone: [0.78, 0.18, 0.96],
        x: 0.86,
        w: 0.09,
        bottom: 0.95,
        aspect: 0.6,
        solid: true,
        draw: Beanbag,
    },
];

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
type Placed = Piece & { rect: Rect };

/** The furniture for a hall of this size, with each piece's box in px. */
function placeFurniture(w: number, h: number): Placed[] {
    return FURNITURE.flatMap((f) => {
        const at: Piece['onPhone'] = isPhone(w) ? f.onPhone : [f.x, f.w, f.bottom];
        if (at === null) return [];
        const [x, fw, bottom] = at ?? [f.x, f.w, f.bottom];
        const pw = fw * w;
        const ph = pw * f.aspect;
        return [{ ...f, x, w: fw, bottom, rect: { x: x * w, y: bottom * h - ph, w: pw, h: ph } }];
    });
}

interface Spot {
    x: number;
    y: number;
    /** Facing left. */
    left: boolean;
    /** Walk duration of the current move, ms. */
    ms: number;
    /** A detour: once here, walk on to `then`. */
    then?: Spot;
}

/** The hall in px, with the robot size for its width. */
interface Hall2D {
    w: number;
    h: number;
    bw: number;
    bh: number;
    /** Highest a robot's box may start (its feet on the floor's back edge). */
    top: number;
    furniture: Placed[];
    /**
     * Per solid piece, where a robot's box may not start (x0 < x < x1,
     * y0 < y < y1): its body would overlap the piece with its feet level
     * with it, i.e. stand in it or be drawn behind it. In front is fine.
     */
    zones: Array<{ x0: number; x1: number; y0: number; y1: number }>;
}

export function hallOf(w: number, h: number): Hall2D {
    const k = isPhone(w) ? PHONE_SCALE : 1;
    const bw = BOT_W * k;
    const bh = BOT_H * k;
    const furniture = placeFurniture(w, h);
    return {
        w,
        h,
        bw,
        bh,
        top: h * WALL - bh * 0.6,
        furniture,
        zones: furniture
            .filter((f) => f.solid)
            .map(({ rect: r }) => ({
                // The robot's visible body: its box less a thin margin.
                x0: r.x - bw * (1 - BODY_MARGIN),
                x1: r.x + r.w - bw * BODY_MARGIN,
                // Feet from the piece's top edge to just past its front.
                y0: r.y - bh,
                y1: r.y + r.h - bh * (1 - FEET_DEPTH),
            })),
    };
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Does a robot whose box starts at (x, y) stand in or behind furniture? */
export function blocked(hall: Hall2D, x: number, y: number) {
    return hall.zones.some((z) => x > z.x0 && x < z.x1 && y > z.y0 && y < z.y1);
}

function randomSpot(hall: Hall2D, from?: Spot): Spot {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 12; i++) {
        x = rand(0, Math.max(0, hall.w - hall.bw));
        y = rand(hall.top, Math.max(hall.top, hall.h - hall.bh));
        if (!blocked(hall, x, y)) break;
    }
    return { x, y, left: from ? x < from.x : Math.random() < 0.5, ms: rand(3000, 5000) };
}

/**
 * Can a robot walk straight from a to b without passing into or behind
 * furniture? Exact: the segment against each no-go zone (slab test), so a
 * long walk can't cut a corner between samples, and cheap on old phones.
 */
export function clearPath(hall: Hall2D, a: Spot, b: Spot) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return !hall.zones.some((z) => {
        let t0 = 0;
        let t1 = 1;
        for (const [p, d, lo, hi] of [
            [a.x, dx, z.x0, z.x1],
            [a.y, dy, z.y0, z.y1],
        ] as const) {
            if (Math.abs(d) < 1e-9) {
                if (p <= lo || p >= hi) return false;
                continue;
            }
            let u0 = (lo - p) / d;
            let u1 = (hi - p) / d;
            if (u0 > u1) [u0, u1] = [u1, u0];
            t0 = Math.max(t0, u0);
            t1 = Math.min(t1, u1);
            if (t0 >= t1) return false;
        }
        return true;
    });
}

const dist = (a: Spot, b: Spot) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The walk from `from` to `to`: straight when the way is clear, otherwise the
 * shortest way round the furniture via its corners — e.g. from one side of
 * the table to the other takes two. `null` when there is no way.
 * `keepFacing` keeps `to.left` on arrival (line-ups and meetings face a set
 * way); otherwise robots face where they walk.
 */
export function route(hall: Hall2D, from: Spot, to: Spot, keepFacing = false): Spot | null {
    // Already inside furniture (e.g. after a resize): just walk out.
    if (clearPath(hall, from, to) || blocked(hall, from.x, from.y)) {
        return { ...to, left: keepFacing ? to.left : to.x < from.x };
    }
    // Shortest path over the points just outside each zone's corners
    // (Dijkstra on a ~26-point visibility graph: cheap even on old phones).
    const nodes: Spot[] = [from];
    for (const z of hall.zones) {
        for (const [x, y] of [
            [z.x0 - 1, z.y0 - 1],
            [z.x1 + 1, z.y0 - 1],
            [z.x0 - 1, z.y1 + 1],
            [z.x1 + 1, z.y1 + 1],
        ] as const) {
            const c = {
                x: clamp(x, 0, hall.w - hall.bw),
                y: clamp(y, hall.top, hall.h - hall.bh),
                left: false,
                ms: 0,
            };
            // A corner it already stands on would never fire transitionend.
            if (dist(from, c) >= 2 && !blocked(hall, c.x, c.y)) nodes.push(c);
        }
    }
    nodes.push(to);
    const goal = nodes.length - 1;
    const cost = nodes.map((_, i) => (i === 0 ? 0 : Infinity));
    const prev = nodes.map(() => -1);
    const done = nodes.map(() => false);
    for (;;) {
        let u = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (!done[i] && cost[i]! < Infinity && (u < 0 || cost[i]! < cost[u]!)) u = i;
        }
        if (u < 0 || u === goal) break;
        done[u] = true;
        for (let v = 0; v < nodes.length; v++) {
            if (done[v]) continue;
            const d = cost[u]! + dist(nodes[u]!, nodes[v]!);
            if (d < cost[v]! && clearPath(hall, nodes[u]!, nodes[v]!)) {
                cost[v] = d;
                prev[v] = u;
            }
        }
    }
    if (prev[goal] === -1) return null;
    const path: Spot[] = [];
    for (let i = goal; i !== -1; i = prev[i]!) path.unshift(nodes[i]!);
    const length = (ps: Spot[]) => ps.slice(1).reduce((d, p, i) => d + dist(ps[i]!, p), 0);
    // Chain the legs, sharing the walk's time by distance.
    const total = length(path);
    let next: Spot | undefined;
    for (let i = path.length - 1; i >= 1; i--) {
        const p = path[i]!;
        const prev = path[i - 1]!;
        const arrive = i === path.length - 1 && keepFacing;
        next = {
            x: p.x,
            y: p.y,
            left: arrive ? to.left : p.x < prev.x,
            ms: (to.ms * dist(prev, p)) / total,
            ...(next && { then: next }),
        };
    }
    return next!;
}

/** Where on this row a robot may stand, clear of furniture: [x0, x1] for its box. */
function freeSpan(hall: Hall2D, y: number): [number, number] {
    let x0 = 0;
    let x1 = hall.w;
    for (const z of hall.zones) {
        if (y <= z.y0 || y >= z.y1) continue;
        if ((z.x0 + z.x1) / 2 + hall.bw / 2 < hall.w / 2) x0 = Math.max(x0, z.x1);
        else x1 = Math.min(x1, z.x0 + hall.bw);
    }
    return [x0, x1];
}

/**
 * Evenly spaced line-up in the open floor in front of the meeting table (or,
 * when that is too small, between the wall and the table), wrapping into
 * rows and squeezing robots up to 40% closer before adding a row.
 */
export function lineUp(n: number, hall: Hall2D): Spot[] {
    const { w, h, bw, bh } = hall;
    const t = hall.furniture.find((f) => f.key === 'table')!.rect;
    const minSlot = bw * 0.6;
    const bands: Array<[number, number]> = [
        [t.y + t.h - bh * 0.55, h - bh],
        [hall.top, t.y - bh - 2],
    ];
    for (const [y0, y1] of bands) {
        const rows: Array<{ y: number; x0: number; x1: number }> = [];
        for (let y = y0; y <= y1 + 0.5; y += bh) {
            const [x0, x1] = freeSpan(hall, y);
            rows.push({ y, x0, x1 });
        }
        for (let used = 1; used <= rows.length; used++) {
            const per = Math.ceil(n / used);
            const fits = rows
                .slice(0, used)
                .every((r) =>
                    per === 1 ? r.x1 - r.x0 >= bw : (r.x1 - r.x0 - bw) / (per - 1) >= minSlot
                );
            if (!fits) continue;
            return Array.from({ length: n }, (_, i) => {
                const r = rows[Math.floor(i / per)]!;
                const count = Math.min(per, n - Math.floor(i / per) * per);
                const span = r.x1 - r.x0;
                const slot = count > 1 ? Math.min(bw, (span - bw) / (count - 1)) : bw;
                const start = r.x0 + (span - (count - 1) * slot - bw) / 2;
                return { x: start + (i % per) * slot, y: r.y, left: false, ms: 1200 };
            });
        }
    }
    // Too many to fit around the furniture: rows across the whole floor.
    const rowsFit = Math.max(1, Math.floor((h - hall.top) / bh));
    const perRow = Math.max(1, Math.floor(w / bw), Math.ceil(n / rowsFit));
    const slot = perRow > 1 ? Math.min(bw, (w - bw) / (perRow - 1)) : bw;
    return Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, n - row * perRow);
        const x0 = (w - (inRow - 1) * slot - bw) / 2;
        return { x: x0 + (i % perRow) * slot, y: hall.top + row * bh, left: false, ms: 1200 };
    });
}

/** A ring around the meeting table, everyone facing it. */
export function ring(n: number, hall: Hall2D): Spot[] {
    const t = hall.furniture.find((f) => f.key === 'table')!.rect;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h * 0.75;
    const rx = t.w / 2 + hall.bw * 0.45;
    const ry = t.h / 2 + hall.bh * 0.3;
    return Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        // The table is a box, the ring an ellipse: step out until clear.
        let feetX = cx + rx * Math.cos(a);
        let feetY = cy + ry * Math.sin(a);
        for (let k = 0; k < 12 && blocked(hall, feetX - hall.bw / 2, feetY - hall.bh); k++) {
            feetX += Math.cos(a) * 6;
            feetY += Math.sin(a) * 6;
        }
        return {
            x: clamp(feetX - hall.bw / 2, 0, hall.w - hall.bw),
            y: clamp(feetY - hall.bh, hall.top, hall.h - hall.bh),
            left: feetX > cx,
            ms: 1600,
        };
    });
}

/** A crowd in front of the coffee counter, clear of the furniture beside it. */
export function coffeeQueue(n: number, hall: Hall2D): Spot[] {
    const c = hall.furniture.find((f) => f.key === 'counter')!.rect;
    const front = c.y + c.h + hall.bh * FEET_DEPTH;
    return Array.from({ length: n }, () => {
        let x = 0;
        let y = 0;
        for (let i = 0; i < 12; i++) {
            x = clamp(rand(c.x - hall.w * 0.22, c.x + c.w - hall.bw), 0, hall.w - hall.bw);
            y = clamp(rand(front, front + hall.h * 0.22) - hall.bh, hall.top, hall.h - hall.bh);
            if (!blocked(hall, x, y)) break;
        }
        return { x, y, left: false, ms: rand(1500, 2500) };
    });
}

/**
 * The agent roster as a hall of little robots: they wander between the
 * furniture, each is a link to its agent, and "Fun action" makes them do
 * something silly.
 *
 * Built for old phones: robots move only by CSS transform transitions
 * (compositor work, no per-frame layout or JS); the furniture is static SVG;
 * one interval retargets a few robots every 2.5s and stops while the hall is
 * off-screen, the tab hidden, or the user prefers reduced motion.
 */
export function AgentRoom({ agents }: IAgentRoomProps) {
    const { mode } = useThemeModeContext();
    const { agentIds: busy } = useActiveRuns();
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
    const roomRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [spots, setSpots] = useState<Record<string, Spot>>({});
    const [walking, setWalking] = useState<Set<string>>(new Set());
    const [action, setAction] = useState<ActionKey | null>(null);
    const [visible, setVisible] = useState(true);
    const actionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const lastAction = useRef<ActionKey | null>(null);
    const c = HALL[mode];

    const active = agents
        .filter((a) => a.status === 'active')
        .sort((a, b) => Number(busy.has(b.id)) - Number(busy.has(a.id)));
    const shown = active.slice(0, MAX_ROBOTS);
    const ids = shown.map((a) => a.id).join(',');
    const hasRoom = shown.length > 0;
    const hall = hallOf(size.w, size.h);
    const performStep = isPhone(size.w)
        ? Math.max(1, Math.ceil(shown.length / PHONE_PERFORMERS))
        : 1;

    // One ResizeObserver for the hall's size; robots are placed in px.
    useLayoutEffect(() => {
        const el = roomRef.current;
        if (!el) return;
        const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [hasRoom]);

    // Off-screen or hidden tab: stop retargeting and pause the CSS animations.
    useEffect(() => {
        const el = roomRef.current;
        if (!el) return;
        let onScreen = true;
        const update = () => setVisible(onScreen && document.visibilityState === 'visible');
        const io = new IntersectionObserver(([e]) => {
            onScreen = e?.isIntersecting ?? true;
            update();
        });
        io.observe(el);
        document.addEventListener('visibilitychange', update);
        return () => {
            io.disconnect();
            document.removeEventListener('visibilitychange', update);
        };
    }, [hasRoom]);

    // Who is mid-walk, for the wander tick (which leaves them be).
    const walkingRef = useRef(walking);
    walkingRef.current = walking;

    // Each robot's element, to read where a robot mid-walk actually is.
    const robotEls = useRef(new Map<string, HTMLElement>());
    const whereNow = (id: string, target: Spot): Spot => {
        const el = robotEls.current.get(id);
        const t = el && getComputedStyle(el).transform;
        if (!t || t === 'none' || typeof DOMMatrix === 'undefined') return target;
        const m = new DOMMatrix(t);
        return { x: m.m41, y: m.m42, left: target.left, ms: target.ms };
    };

    const placeAll = (place: (n: number, hall: Hall2D) => Spot[], keepFacing: boolean) => {
        const at = place(shown.length, hall);
        setSpots((prev) =>
            Object.fromEntries(
                shown.map((a, i) => {
                    const to = at[i]!;
                    const target = prev[a.id];
                    // Plan from where it is now: mid-walk, its target is not.
                    const from = target && whereNow(a.id, target);
                    // No way round (rare): stay put rather than walk through.
                    return [a.id, from ? (route(hall, from, to, keepFacing) ?? from) : to];
                })
            )
        );
        setWalking(new Set(shown.map((a) => a.id)));
    };

    // Place newcomers (and everyone, on resize); reduced motion stands in a line.
    useEffect(() => {
        if (!size.w) return;
        if (reduceMotion) {
            const at = lineUp(shown.length, hall);
            setSpots(Object.fromEntries(shown.map((a, i) => [a.id, at[i]!])));
            return;
        }
        setSpots((prev) =>
            Object.fromEntries(
                shown.map((a) => {
                    const p = prev[a.id];
                    const fits = p && p.x <= size.w - hall.bw && p.y <= size.h - hall.bh;
                    return [a.id, fits ? p : randomSpot(hall)];
                })
            )
        );
    }, [ids, size.w, size.h, reduceMotion]);

    // Wander: every tick, send one or two robots somewhere new.
    const still = ACTIONS.find((a) => a.key === action)?.still ?? false;
    const wandering = visible && !reduceMotion && !still && size.w > 0;
    useEffect(() => {
        if (!wandering) return;
        const tick = () => {
            // Only robots standing still: a new target mid-walk would start
            // from wherever it is, which the route never checked.
            const idle = shown.filter((a) => !walkingRef.current.has(a.id));
            const picks = new Set<string>();
            const n = Math.ceil(Math.random() * Math.min(2, idle.length));
            while (picks.size < n) picks.add(idle[Math.floor(Math.random() * idle.length)]!.id);
            if (picks.size === 0) return;
            setSpots((prev) => {
                const next = { ...prev };
                for (const id of picks) {
                    const from = prev[id];
                    if (!from) continue;
                    // A few tries for a target the robot can reach.
                    for (let i = 0; i < 4; i++) {
                        const walk = route(hall, from, randomSpot(hall, from));
                        if (walk) {
                            next[id] = walk;
                            break;
                        }
                    }
                }
                return next;
            });
            setWalking((prev) => new Set([...prev, ...picks]));
        };
        const t = setInterval(tick, TICK_MS);
        return () => clearInterval(t);
    }, [wandering, ids, size.w, size.h]);

    useEffect(() => () => clearTimeout(actionTimer.current), []);

    const doFunAction = () => {
        const choices = ACTIONS.filter((a) => a.key !== lastAction.current);
        const next = choices[Math.floor(Math.random() * choices.length)]!.key;
        lastAction.current = next;
        setAction(next);
        if (next === 'assemble') placeAll(lineUp, true);
        if (next === 'meeting') placeAll(ring, true);
        if (next === 'coffee_break') placeAll(coffeeQueue, false);
        if (next === 'moonwalk')
            placeAll((n) => Array.from({ length: n }, () => randomSpot(hall)), false);
        clearTimeout(actionTimer.current);
        actionTimer.current = setTimeout(() => setAction(null), ACTION_MS);
    };

    const caption = ACTIONS.find((a) => a.key === action)?.caption;

    return (
        <Paper
            elevation={0}
            component="section"
            id="agent-roster"
            aria-labelledby="roster-heading"
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                p: { xs: 4, sm: 5 },
                width: '100%',
            }}
        >
            {/* Title on the left, its two icon actions on the right; the count below. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box id="roster-heading" sx={{ mr: 'auto' }}>
                    <FormHeading>Your agents</FormHeading>
                </Box>
                {shown.length > 1 && (
                    <Tooltip title="Fun action">
                        <IconButton size="small" aria-label="Fun action" onClick={doFunAction}>
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 20 }}
                            >
                                auto_awesome
                            </Box>
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Manage agents">
                    <IconButton
                        size="small"
                        aria-label="Manage agents"
                        component={RouterLink}
                        to="/agents"
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 20 }}
                        >
                            tune
                        </Box>
                    </IconButton>
                </Tooltip>
            </Box>
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                {busy.size > 0 ? `${busy.size} working, ` : ''}
                {active.length} active
            </Typography>

            {active.length === 0 ? (
                <Typography sx={{ mt: 4, fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    No active agents.{' '}
                    <Link component={RouterLink} to="/agents/marketplace" underline="hover">
                        Install agents from the Marketplace
                    </Link>
                    .
                </Typography>
            ) : (
                <Box
                    ref={roomRef}
                    data-action={action ?? undefined}
                    data-paused={visible ? undefined : ''}
                    sx={{
                        position: 'relative',
                        mt: 4,
                        height: { xs: 360, md: 480 },
                        borderRadius: '8px',
                        overflow: 'hidden',
                        contain: 'layout paint',
                        // Wooden floor planks; the wall is drawn on top.
                        bgcolor: c.floor,
                        backgroundImage: `repeating-linear-gradient(0deg, transparent 0 31px, ${c.plank} 31px 33px)`,
                        '@keyframes atlas-bot-bob': {
                            '0%, 100%': { transform: 'translateY(0)' },
                            '50%': { transform: 'translateY(-3px)' },
                        },
                        '@keyframes atlas-bot-spin': { to: { transform: 'rotate(360deg)' } },
                        '@keyframes atlas-bot-jump': {
                            '0%, 100%': { transform: 'translateY(0) scaleY(1)' },
                            '20%': { transform: 'translateY(0) scaleY(0.85)' },
                            '50%': { transform: 'translateY(-26px) scaleY(1.05)' },
                        },
                        '@keyframes atlas-bot-arm': {
                            from: { transform: 'rotate(0deg)' },
                            to: { transform: 'rotate(-160deg)' },
                        },
                        '@keyframes atlas-bot-z': {
                            from: { transform: 'translate(0, 0)', opacity: 1 },
                            to: { transform: 'translate(10px, -22px)', opacity: 0 },
                        },
                        '@keyframes atlas-hall-fade': { from: { opacity: 0 } },
                        '@keyframes atlas-hall-caption': {
                            '0%': { opacity: 0, transform: 'translate(-50%, 10px) scale(0.9)' },
                            '12%, 80%': { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
                            '100%': { opacity: 0, transform: 'translate(-50%, -14px) scale(1)' },
                        },
                        '&[data-paused] *': { animationPlayState: 'paused' },
                        '&[data-action="heads"] .bot-perform .bot-head': {
                            animation: 'atlas-bot-spin 0.8s linear infinite',
                        },
                        '&[data-action="wave"] .bot-perform .bot-arm-r': {
                            animation: 'atlas-bot-arm 0.4s ease-in-out infinite alternate',
                            animationDelay: 'var(--d)',
                        },
                        '&[data-action="jump"] .bot-perform .bot-body': {
                            animation: 'atlas-bot-jump 0.7s ease-in-out infinite',
                            animationDelay: 'var(--d)',
                        },
                        '&[data-action="nap"] .bot-body': {
                            animation: 'none',
                            transform: 'rotate(-82deg)',
                            transition: 'transform 600ms',
                        },
                        '@media (prefers-reduced-motion: reduce)': {
                            '& *': { animation: 'none !important', transition: 'none !important' },
                        },
                    }}
                >
                    {/* The wall: one box with a skirting board. */}
                    <Box
                        aria-hidden
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            bottom: 'auto',
                            height: `${WALL * 100}%`,
                            bgcolor: c.wall,
                            borderBottom: `6px solid ${c.base}`,
                        }}
                    />
                    {hall.furniture.map((f) => (
                        <Box
                            key={f.key}
                            aria-hidden
                            sx={{
                                position: 'absolute',
                                left: `${f.x * 100}%`,
                                width: `${f.w * 100}%`,
                                bottom: `${(1 - f.bottom) * 100}%`,
                                lineHeight: 0,
                                pointerEvents: 'none',
                                // Robots further down the floor stand in front.
                                zIndex: f.wall ? 0 : Math.round(f.bottom * size.h),
                                '& svg': { width: '100%', height: 'auto', display: 'block' },
                            }}
                        >
                            {f.draw(c)}
                        </Box>
                    ))}

                    {action === 'nap' && (
                        <Box
                            aria-hidden
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 3000,
                                pointerEvents: 'none',
                                bgcolor: 'rgba(2,6,23,.55)',
                                animation: 'atlas-hall-fade 600ms',
                            }}
                        />
                    )}
                    {caption && (
                        <Typography
                            key={action}
                            role="status"
                            sx={{
                                position: 'absolute',
                                // Just below the wall: clear of the whiteboard, and
                                // near the button that started it — a phone shows
                                // the top of the hall, not always its bottom.
                                top: `calc(${WALL * 100}% + 12px)`,
                                left: '50%',
                                zIndex: 3001,
                                pointerEvents: 'none',
                                fontSize: { xs: 18, md: 24 },
                                fontWeight: 800,
                                letterSpacing: '-0.01em',
                                // White with a dark outline, in both themes: it reads
                                // on any floor, robot or lighting, and survives
                                // browsers that recolour pages in dark mode (theme
                                // colours alone vanished on some Android phones).
                                color: '#FFFFFF',
                                textShadow:
                                    '1px 1px 0 #0F172A, -1px 1px 0 #0F172A, 1px -1px 0 #0F172A, -1px -1px 0 #0F172A, 0 2px 0 #0F172A, 0 3px 10px rgba(0,0,0,.45)',
                                whiteSpace: 'nowrap',
                                animation: `atlas-hall-caption ${ACTION_MS}ms ease-out forwards`,
                            }}
                        >
                            {caption}
                        </Typography>
                    )}

                    {shown.map((agent, i) => {
                        const spot = spots[agent.id];
                        if (!spot) return null;
                        const cat = CATEGORIES.find((cc) => cc.key === agent.category);
                        const badge = LABEL_COLORS[cat?.color ?? 'slate'].light.border;
                        // Spread evenly through the hall; everyone off phones.
                        const performer = i % performStep === 0;
                        // Mid-action on a phone, only performers bob as they walk.
                        const bob = walking.has(agent.id) && (performer || action === null);
                        // Moonwalk: walk one way, face the other.
                        const left = action === 'moonwalk' ? !spot.left : spot.left;
                        return (
                            <Link
                                key={agent.id}
                                className={performer ? 'bot-perform' : undefined}
                                ref={(el: HTMLAnchorElement | null) => {
                                    if (el) robotEls.current.set(agent.id, el);
                                    else robotEls.current.delete(agent.id);
                                }}
                                component={RouterLink}
                                to={`/agents/${agent.id}`}
                                aria-label={`${agent.name}${busy.has(agent.id) ? ' (working)' : ''}`}
                                title={agent.name}
                                underline="none"
                                onTransitionEnd={(e) => {
                                    // The body's own transitions bubble up too.
                                    if (e.target !== e.currentTarget) return;
                                    const then = spots[agent.id]?.then;
                                    if (then) {
                                        setSpots((prev) => ({ ...prev, [agent.id]: then }));
                                        return;
                                    }
                                    setWalking((prev) => {
                                        const next = new Set(prev);
                                        next.delete(agent.id);
                                        return next;
                                    });
                                }}
                                sx={{
                                    '--d': `${(i * 97) % 600}ms`,
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    width: hall.bw,
                                    height: hall.bh,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'flex-end',
                                    transform: `translate3d(${spot.x}px, ${spot.y}px, 0)`,
                                    transition: `transform ${spot.ms}ms ease-in-out`,
                                    // Robots and furniture further down stand in front.
                                    zIndex: Math.round(spot.y + hall.bh),
                                    '&:hover, &:focus-visible': { zIndex: 2000 },
                                    '&:hover .bot-body, &:focus-visible .bot-body': {
                                        transform: 'scale(1.12)',
                                    },
                                    // Names only on hover/focus: a crowded hall
                                    // otherwise piles labels on top of each other.
                                    '&:hover .bot-name, &:focus-visible .bot-name': {
                                        opacity: 1,
                                    },
                                }}
                            >
                                <Box
                                    className="bot-body"
                                    sx={{
                                        lineHeight: 0,
                                        transformOrigin: '50% 100%',
                                        transition: 'transform 150ms',
                                        animation: bob
                                            ? 'atlas-bot-bob 0.4s ease-in-out infinite'
                                            : 'none',
                                    }}
                                >
                                    <Robot
                                        size={hall.bw * 0.8}
                                        body={bodyColor(agent.id)}
                                        badge={badge}
                                        ink={c.ink}
                                        working={busy.has(agent.id)}
                                        left={left}
                                    />
                                </Box>
                                {action === 'nap' && performer && (
                                    <Box
                                        component="span"
                                        aria-hidden
                                        sx={{
                                            position: 'absolute',
                                            top: '20%',
                                            right: 0,
                                            zIndex: 3002,
                                            fontSize: 13,
                                            fontWeight: 800,
                                            color: '#FFFFFF',
                                            animation: 'atlas-bot-z 1.4s ease-out infinite',
                                            animationDelay: 'var(--d)',
                                        }}
                                    >
                                        z
                                    </Box>
                                )}
                                <Typography
                                    component="span"
                                    className="bot-name"
                                    noWrap
                                    sx={{
                                        position: 'absolute',
                                        bottom: '100%',
                                        maxWidth: 160,
                                        px: 1.5,
                                        py: 0.5,
                                        borderRadius: '4px',
                                        bgcolor: 'background.paper',
                                        boxShadow: ELEVATION.low,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                        opacity: 0,
                                        transition: 'opacity 120ms',
                                        pointerEvents: 'none',
                                    }}
                                >
                                    {agent.name}
                                </Typography>
                            </Link>
                        );
                    })}
                </Box>
            )}

            {active.length > MAX_ROBOTS && (
                <Link
                    component={RouterLink}
                    to="/agents"
                    underline="hover"
                    sx={{
                        display: 'inline-block',
                        mt: 2,
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    +{active.length - MAX_ROBOTS} more
                </Link>
            )}
        </Paper>
    );
}

/**
 * One part of a robot drawn in its own small SVG, positioned over the robot
 * in the robot's 44×56 drawing units (`viewBox` = its box, so the parts keep
 * the drawing's coordinates). The head and arms are separate HTML boxes
 * because only an HTML element's transform animates on the GPU: rotating a
 * `<g>` inside one SVG repaints every robot on the main thread each frame,
 * which halved the frame rate on old phones.
 */
function Part({
    className,
    box: [x, y, w, h],
    origin,
    children,
}: {
    className: string;
    box: [number, number, number, number];
    origin: string;
    children: ReactNode;
}) {
    return (
        <Box
            className={className}
            sx={{
                position: 'absolute',
                left: `${(x / 44) * 100}%`,
                top: `${(y / 56) * 100}%`,
                width: `${(w / 44) * 100}%`,
                height: `${(h / 56) * 100}%`,
                transformOrigin: origin,
                '& svg': { display: 'block', width: '100%', height: '100%', overflow: 'visible' },
            }}
        >
            <svg viewBox={`${x} ${y} ${w} ${h}`}>{children}</svg>
        </Box>
    );
}

function Robot({
    size,
    body,
    badge,
    ink,
    working,
    left,
}: {
    size: number;
    body: string;
    badge: string;
    ink: string;
    working: boolean;
    left: boolean;
}) {
    return (
        <Box
            aria-hidden="true"
            sx={{
                position: 'relative',
                width: size,
                height: (size * 56) / 44,
                transform: left ? 'scaleX(-1)' : undefined,
            }}
        >
            <Part className="bot-arm bot-arm-l" box={[4, 28, 5, 16.5]} origin="50% 10%">
                <rect x="4" y="28" width="5" height="14" rx="2.5" fill={body} />
                <circle cx="6.5" cy="42" r="2.5" fill={ink} />
            </Part>
            <Part className="bot-arm bot-arm-r" box={[35, 28, 5, 16.5]} origin="50% 10%">
                <rect x="35" y="28" width="5" height="14" rx="2.5" fill={body} />
                <circle cx="37.5" cy="42" r="2.5" fill={ink} />
            </Part>
            <Part className="bot-torso" box={[0, 26, 44, 30]} origin="50% 50%">
                <ellipse cx="22" cy="54" rx="12" ry="2" fill="rgba(0,0,0,.18)" />
                <rect x="14" y="44" width="6" height="9" rx="2" fill={ink} />
                <rect x="24" y="44" width="6" height="9" rx="2" fill={ink} />
                <rect x="10" y="26" width="24" height="20" rx="6" fill={body} />
                <rect x="13" y="29" width="18" height="2" rx="1" fill="rgba(255,255,255,.35)" />
                <circle cx="22" cy="37" r="4" fill={badge} stroke="#FFFFFF" strokeWidth="1.5" />
            </Part>
            <Part className="bot-head" box={[0, 0, 44, 26]} origin="50% 50%">
                <line x1="22" y1="2" x2="22" y2="8" stroke={ink} strokeWidth="1.8" />
                <circle cx="22" cy="3" r="3" fill={working ? '#22C55E' : '#FACC15'} />
                <rect x="5" y="13" width="4" height="7" rx="1.5" fill={ink} />
                <rect x="35" y="13" width="4" height="7" rx="1.5" fill={ink} />
                <rect x="8" y="7" width="28" height="19" rx="7" fill={body} />
                <rect x="11" y="10" width="22" height="13" rx="5" fill="#0F172A" />
                <circle cx="17" cy="16.5" r="2.6" fill="#5EEAD4" />
                <circle cx="27" cy="16.5" r="2.6" fill="#5EEAD4" />
                <rect x="19" y="20" width="6" height="1.6" rx="0.8" fill="#5EEAD4" />
            </Part>
        </Box>
    );
}

function Window(c: Hall) {
    return (
        <svg viewBox="0 0 60 42">
            <rect width="60" height="42" rx="3" fill={c.frame} />
            <rect x="3" y="3" width="54" height="36" rx="1.5" fill={c.glass} />
            <ellipse cx="18" cy="14" rx="9" ry="3.5" fill="#FFFFFF" opacity=".7" />
            <ellipse cx="40" cy="26" rx="7" ry="2.8" fill="#FFFFFF" opacity=".55" />
            <rect x="29" y="3" width="2" height="36" fill={c.frame} />
            <rect x="3" y="20" width="54" height="2" fill={c.frame} />
            <rect x="-2" y="40" width="64" height="3" rx="1" fill={c.woodDark} />
        </svg>
    );
}

function Whiteboard(c: Hall) {
    return (
        <svg viewBox="0 0 100 50">
            <rect width="100" height="50" rx="3" fill={c.frame} />
            <rect x="3" y="3" width="94" height="44" rx="2" fill={c.board} />
            <rect x="9" y="9" width="34" height="3" rx="1.5" fill="#6366F1" />
            <rect x="9" y="15" width="24" height="2" rx="1" fill="#94A3B8" />
            <rect x="12" y="30" width="7" height="12" fill="#22C55E" />
            <rect x="22" y="24" width="7" height="18" fill="#3B82F6" />
            <rect x="32" y="33" width="7" height="9" fill="#F97316" />
            <rect x="42" y="20" width="7" height="22" fill="#A855F7" />
            <polyline
                points="58,40 66,32 74,35 82,22 90,14"
                fill="none"
                stroke="#F43F5E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <rect x="40" y="47" width="20" height="3" rx="1" fill={c.metal} />
        </svg>
    );
}

function Clock(c: Hall) {
    return (
        <Box sx={{ position: 'relative' }}>
            <svg viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="9.5" fill={c.board} stroke={c.frame} strokeWidth="1.2" />
                <line x1="10" y1="10" x2="10" y2="5" stroke={c.metal} strokeWidth="1.2" />
                <line x1="10" y1="10" x2="13.5" y2="11" stroke={c.metal} strokeWidth="1.2" />
                <circle cx="10" cy="10" r="1" fill={c.metal} />
            </svg>
            {/* The second hand is an HTML box, not an SVG line: an animation
                inside an SVG runs on the main thread and forced a style pass
                over the whole hall every frame, even at one step a second. */}
            <Box
                aria-hidden
                sx={{
                    position: 'absolute',
                    // The hand's line, in the clock's 20-unit drawing: x 10,
                    // y 3 → 11.5, turning about the centre (10, 10).
                    left: '48.5%',
                    top: '15%',
                    width: '3%',
                    minWidth: '1px',
                    height: '42.5%',
                    bgcolor: '#F43F5E',
                    transformOrigin: '50% 82.35%',
                    animation: 'atlas-bot-spin 60s steps(60) infinite',
                }}
            />
        </Box>
    );
}

function Rug(c: Hall) {
    return (
        <svg viewBox="0 0 100 30">
            <ellipse cx="50" cy="15" rx="50" ry="15" fill={c.rugEdge} />
            <ellipse cx="50" cy="15" rx="45" ry="12" fill={c.rug} />
            <ellipse
                cx="50"
                cy="15"
                rx="34"
                ry="8"
                fill="none"
                stroke={c.rugEdge}
                strokeWidth="1"
                strokeDasharray="3 3"
            />
        </svg>
    );
}

function Sofa(c: Hall) {
    return (
        <svg viewBox="0 0 80 34">
            <rect x="6" y="0" width="68" height="18" rx="6" fill={c.fabricDark} />
            <rect x="0" y="10" width="12" height="20" rx="5" fill={c.fabric} />
            <rect x="68" y="10" width="12" height="20" rx="5" fill={c.fabric} />
            <rect x="10" y="16" width="30" height="12" rx="4" fill={c.fabric} />
            <rect x="40" y="16" width="30" height="12" rx="4" fill={c.fabric} />
            <rect x="16" y="5" width="12" height="10" rx="3" fill="#FACC15" />
            <rect x="5" y="30" width="4" height="4" fill={c.woodDark} />
            <rect x="71" y="30" width="4" height="4" fill={c.woodDark} />
        </svg>
    );
}

function Plant(c: Hall) {
    return (
        <svg viewBox="0 0 20 36">
            <ellipse cx="10" cy="10" rx="4" ry="9" fill={c.leafDark} />
            <ellipse cx="5" cy="15" rx="3" ry="8" fill={c.leaf} transform="rotate(-25 5 15)" />
            <ellipse cx="15" cy="15" rx="3" ry="8" fill={c.leaf} transform="rotate(25 15 15)" />
            <path d="M3 22 H17 L15 36 H5 Z" fill={c.pot} />
            <rect x="2" y="21" width="16" height="3" rx="1" fill={c.pot} />
        </svg>
    );
}

function Shelf(c: Hall) {
    const books = ['#F43F5E', '#3B82F6', '#EAB308', '#22C55E', '#A855F7', '#06B6D4'];
    return (
        <svg viewBox="0 0 40 52">
            <rect width="40" height="52" rx="2" fill={c.woodDark} />
            <rect x="3" y="3" width="34" height="46" fill={c.wood} />
            {[0, 1, 2].map((row) => (
                <g key={row}>
                    {books.slice(row, row + 4).map((b, i) => (
                        <rect
                            key={b}
                            x={5 + i * 7}
                            y={5 + row * 15 + (i % 2) * 2}
                            width="5"
                            height={11 - (i % 2) * 2}
                            fill={b}
                        />
                    ))}
                    <rect x="3" y={17 + row * 15} width="34" height="2" fill={c.woodDark} />
                </g>
            ))}
        </svg>
    );
}

function Coffee(c: Hall) {
    return (
        <svg viewBox="0 0 60 48">
            <rect x="0" y="22" width="60" height="26" rx="2" fill={c.wood} />
            <rect x="-1" y="20" width="62" height="4" rx="1" fill={c.woodDark} />
            <rect x="6" y="28" width="22" height="16" rx="1" fill={c.woodDark} opacity=".5" />
            <rect x="32" y="28" width="22" height="16" rx="1" fill={c.woodDark} opacity=".5" />
            <rect x="8" y="0" width="22" height="20" rx="3" fill={c.metal} />
            <rect x="11" y="4" width="16" height="5" rx="1" fill="#1E293B" />
            <circle cx="25" cy="6.5" r="1.4" fill="#F43F5E" />
            <rect x="15" y="12" width="8" height="6" rx="1" fill="#FFFFFF" />
            <rect x="38" y="13" width="6" height="7" rx="1" fill="#F97316" />
            <rect x="47" y="13" width="6" height="7" rx="1" fill="#06B6D4" />
        </svg>
    );
}

function Table(c: Hall) {
    return (
        <svg viewBox="0 0 100 38">
            <rect x="12" y="16" width="4" height="22" fill={c.woodDark} />
            <rect x="84" y="16" width="4" height="22" fill={c.woodDark} />
            <ellipse cx="50" cy="16" rx="50" ry="14" fill={c.woodDark} />
            <ellipse cx="50" cy="14" rx="50" ry="14" fill={c.wood} />
            <rect x="30" y="6" width="16" height="9" rx="1" fill={c.metal} />
            <rect x="31" y="7" width="14" height="6" fill="#38BDF8" />
            <circle cx="62" cy="12" r="3" fill="#FFFFFF" />
            <circle cx="72" cy="17" r="3" fill="#FACC15" />
            <rect x="52" y="17" width="10" height="6" rx="1" fill="#FFFFFF" opacity=".85" />
        </svg>
    );
}

function Beanbag(c: Hall) {
    return (
        <svg viewBox="0 0 40 24">
            <path d="M4 22 C0 10, 10 0, 22 2 C34 3, 42 12, 36 22 Z" fill="#A855F7" />
            <path d="M10 20 C10 12, 18 8, 26 10" stroke="#C084FC" strokeWidth="2" fill="none" />
            <ellipse cx="20" cy="22" rx="17" ry="2" fill={c.woodDark} opacity=".25" />
        </svg>
    );
}
