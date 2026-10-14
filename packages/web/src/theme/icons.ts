// Material Symbols the app renders. The icon font is requested with
// `icon_names=` so Google serves only these glyphs: ~26 KB instead of the
// ~540 KB full font, which was 40% of a cold dashboard load on slow 4G.
//
// Adding an icon? Add its name here (keep the list sorted; Google requires
// it). `icons.test.ts` scans the web, shared and API sources and fails on any icon
// name that's used but missing, so a forgotten one can't ship as raw text.
// The list is a superset: a plain string that happens to be an icon name
// ('start', 'code'...) is in it too, which costs a few bytes and nothing else.
// prettier-ignore
export const ICONS = [
    '2d', 'account_tree', 'add', 'alarm', 'analytics', 'android', 'api', 'apps', 'architecture',
    'arrow_downward', 'arrow_drop_down', 'arrow_drop_up', 'arrow_upward', 'article',
    'assistant', 'auto_awesome', 'automation', 'block', 'brush', 'bug_report', 'build',
    'cached', 'cadence', 'call_merge', 'campaign', 'cards', 'category', 'change_circle',
    'check', 'check_box', 'check_circle', 'checklist', 'chevron_right', 'circle',
    'cleaning_services', 'close', 'cloud', 'cloud_off', 'code', 'comment', 'content_copy',
    'create', 'css', 'dashboard', 'dashboard_customize', 'delete', 'description',
    'developer_board', 'docs', 'done', 'download', 'draft', 'drag_indicator', 'edit',
    'edit_note', 'email', 'enterprise', 'error', 'event', 'expand_more', 'fact_check', 'filter',
    'filter_alt_off', 'flag', 'flaky', 'folder', 'folder_open', 'fork_right', 'front_hand',
    'function', 'gavel', 'grid_view', 'group', 'height', 'help', 'help_outline', 'history',
    'home', 'host', 'hourglass_empty', 'info', 'input', 'key', 'label', 'light', 'lightbulb',
    'link', 'list', 'loop', 'memory', 'menu', 'menu_book', 'merge', 'merge_type', 'message',
    'mode', 'monitoring', 'more', 'more_horiz', 'more_vert', 'move', 'newspaper',
    'notifications', 'open_in_new', 'output', 'overview', 'palette', 'password', 'pause',
    'pending', 'person', 'play_arrow', 'play_circle', 'policy', 'post',
    'precision_manufacturing', 'preview', 'priority', 'psychology', 'queue', 'radio',
    'radio_button_unchecked', 'refresh', 'reminder', 'remove', 'replay', 'resize', 'resume',
    'rocket_launch', 'save', 'schedule', 'science', 'script', 'search', 'security', 'select',
    'send', 'settings', 'shield', 'shield_with_heart', 'smart_toy', 'sort', 'source', 'speed',
    'stack', 'star', 'start', 'steps', 'sticky_note_2', 'stop', 'stop_circle', 'storage',
    'storefront', 'support_agent', 'swap_horiz', 'switch', 'sync', 'sync_alt', 'sync_disabled',
    'tab', 'table', 'target', 'task', 'task_alt', 'terminal', 'timeline', 'tips_and_updates',
    'title', 'today', 'token', 'travel_explore', 'tune', 'undo', 'update', 'upgrade', 'upload',
    'uppercase', 'verified', 'visibility', 'visibility_off', 'warning', 'width', 'window',
    'workflow',
] as const;

const ICON_SET: ReadonlySet<string> = new Set(ICONS);

/**
 * Icons that come from data (agent glyphs, guardrail rules) may name a glyph
 * the subset doesn't carry; render the fallback instead of ligature text.
 */
export function iconOr(name: string | null | undefined, fallback: string): string {
    return name && ICON_SET.has(name) ? name : fallback;
}

// Only FILL varies in the app (0/1); the other axes stay at the font's
// defaults. Requesting their full ranges made current Chrome download the
// whole 5.2 MB variable font.
//
// `display=block` is load-bearing, not a tweak. Without it the face resolves
// to `font-display: auto`, and during the swap period every icon paints as its
// raw ligature text. `block` keeps the glyph box blank until the font arrives.
// Never use `swap` on an icon font.
export const ICON_FONT_URL =
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0' +
    `&icon_names=${ICONS.join(',')}&display=block`;
