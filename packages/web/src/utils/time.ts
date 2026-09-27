export function relativeTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const diff = Date.now() - t;
    if (diff < 60_000) return 'just now';
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return new Date(t).toLocaleDateString();
}

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

/**
 * Full clock + day label for tooltip use. Renders in the user's local
 * timezone like `Wed 22 May 2026 · 14:23`. The dash separator matches the
 * existing "mono with bullet" idiom Atlas uses in headers, but this
 * returns a plain string so callers can drop it straight into a
 * `<Tooltip title=…>` prop.
 */
export function formatAbsolute(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const datePart = d.toLocaleDateString(undefined, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
    const timePart = d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    return `${datePart} · ${timePart}`;
}

/**
 * A time-to-PR style span, minutes to days, in the unit that reads best:
 * `45s`, `29m`, `3.5h`, `2.1d`. Shared by the fleet page and the Project
 * Health card so the same median never reads two ways.
 */
export function formatSpan(sec: number | null): string {
    if (sec === null) return '—';
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 172_800) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86_400).toFixed(1)}d`;
}

export function formatDurationSec(sec: number | null): string {
    if (sec == null) return '—';
    if (sec < 60) return `${sec.toFixed(1)} s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
}
