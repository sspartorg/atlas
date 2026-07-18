// Time-bucketed greeting bank for the Dashboard kicker.
//
// The kicker pairs with the owner name to form lines like:
//   "BURNING THE MIDNIGHT OIL, SUNNY"
//   "RISE AND SHINE, SUNNY"
//   "POST-LUNCH SCRUM, SUNNY"
//
// 30 variants total, split across four time-of-day buckets so the kicker
// always matches the wall clock — no "Good morning" at 11 pm, no "Burning
// the midnight oil" at lunch.

interface BucketSpec {
    range: [number, number];
    greetings: readonly string[];
}

// Order matters: the first bucket whose `range` matches the current hour
// wins. The late-night bucket wraps over midnight, handled by the
// fallback at the end of `randomGreeting`.
const BUCKETS: readonly BucketSpec[] = [
    {
        range: [5, 11],
        greetings: [
            'Good morning',
            'Rise and shine',
            'Top of the morning',
            'Morning, early bird',
            'Fresh start',
            'Ready to push',
            "Coffee's brewing",
            'Inbox is calmest now',
        ],
    },
    {
        range: [12, 16],
        greetings: [
            'Good afternoon',
            'Post-lunch scrum',
            'Afternoon grind',
            'Half the day, half the queue',
            'Prime productivity hour',
            "Sun's high, queue's higher",
            'Tea time',
        ],
    },
    {
        range: [17, 20],
        greetings: [
            'Good evening',
            'Almost done',
            'Wrapping up',
            'Evening shift',
            'Dusk patrol',
            'One more push',
            'Sunset standup',
        ],
    },
];

// Late-night (21:00–04:59) — used when no other bucket matches.
const LATE_NIGHT_GREETINGS: readonly string[] = [
    'Burning the midnight oil',
    'Night owl mode',
    'Still here?',
    'Past your bedtime',
    'Ghost in the machine',
    'Agent hours',
    'Welcome to the night shift',
    'Caffeine, not sleep',
];

/**
 * Random kicker for the current local hour. Picks one of the variants
 * tagged with the right time-of-day bucket. Inject `now` for tests.
 */
export function randomGreeting(now: Date = new Date()): string {
    const hour = now.getHours();
    const bucket =
        BUCKETS.find((b) => hour >= b.range[0] && hour <= b.range[1])?.greetings ??
        LATE_NIGHT_GREETINGS;
    const idx = Math.floor(Math.random() * bucket.length);
    return bucket[idx] ?? bucket[0]!;
}

// Test-only: full flat list of every greeting in every bucket. Used by
// the spec to assert the total stays at 30 and the rendered kicker comes
// from a known variant.
export const __GREETING_BANK: readonly string[] = [
    ...BUCKETS.flatMap((b) => b.greetings),
    ...LATE_NIGHT_GREETINGS,
];
