import * as os from 'node:os';

const WEB_PORT = Number(process.env['WEB_PORT'] ?? process.env['PORT']) || 4000;

const STATIC_ORIGINS = [`http://localhost:${WEB_PORT}`, `http://127.0.0.1:${WEB_PORT}`] as const;

// `pnpm prod:https` (ADR 0031) serves the UI through Caddy over HTTPS +
// HTTP/2 on ATLAS_HTTPS_PORT; trust that origin only when it is configured.
// Read per call: tests and main.ts set env after this module loads.
function httpsOrigins(): string[] {
    const port = Number(process.env['ATLAS_HTTPS_PORT']);
    if (!Number.isInteger(port) || port <= 0) return [];
    return [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
}

function isLanAccessEnabled(): boolean {
    const v = process.env['ATLAS_LAN_ACCESS'];
    if (!v) return false;
    return v === '1' || v.toLowerCase() === 'true';
}

// Walk every network interface and return non-internal IPv4 addresses. Skips
// loopback (handled by the static origins above), link-local 169.254.x.x, and
// IPv6. VPN / virtual adapter IPs are intentionally included — the boot log
// surfaces them so the user can tell what they opened up.
function detectLanIps(): string[] {
    const ips: string[] = [];
    const ifs = os.networkInterfaces();
    for (const iface of Object.values(ifs)) {
        if (!iface) continue;
        for (const addr of iface) {
            if (addr.internal) continue;
            if (addr.family !== 'IPv4') continue;
            if (addr.address.startsWith('169.254.')) continue;
            ips.push(addr.address);
        }
    }
    return ips;
}

export function getLanOrigins(): string[] {
    if (!isLanAccessEnabled()) return [];
    const origins = detectLanIps().map((ip) => `http://${ip}:${WEB_PORT}`);
    // The machine's mDNS name (http://<hostname>.local:<port>) — same trust
    // level as its LAN IPs. Browsers lowercase the host in the Origin header,
    // and macOS os.hostname() may already carry the .local suffix, so
    // normalize both before appending.
    const host = os
        .hostname()
        .toLowerCase()
        .replace(/\.local$/, '');
    if (host) origins.push(`http://${host}.local:${WEB_PORT}`);
    return origins;
}

export function getAllowedOrigins(): string[] {
    return [...STATIC_ORIGINS, ...httpsOrigins(), ...getLanOrigins()];
}

// Mirrors the static + LAN union used by CORS so the MCP-token gate trusts
// the same set of browser origins it would let through pre-flight.
export function getTrustedBrowserOrigins(): Set<string> {
    return new Set(getAllowedOrigins());
}
