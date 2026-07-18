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

export function formatDurationSec(sec: number | null): string {
    if (sec == null) return '—';
    if (sec < 60) return `${sec.toFixed(1)} s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
}
