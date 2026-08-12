import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OS from 'node:os';

const FIXTURE_INTERFACES = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
    eth0: [
        { address: '192.168.1.50', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: 'aa:bb:cc:dd:ee:ff', cidr: '192.168.1.50/24' },
        { address: 'fe80::1', family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', mac: 'aa:bb:cc:dd:ee:ff', scopeid: 0, cidr: 'fe80::1/64' },
    ],
    vEthernet: [{ address: '169.254.42.7', family: 'IPv4', internal: false, netmask: '255.255.0.0', mac: '11:22:33:44:55:66', cidr: '169.254.42.7/16' }],
    en1: [{ address: '10.0.0.5', family: 'IPv4', internal: false, netmask: '255.0.0.0', mac: '99:88:77:66:55:44', cidr: '10.0.0.5/8' }],
};

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof OS>();
    return {
        ...actual,
        networkInterfaces: vi.fn(() => FIXTURE_INTERFACES),
        // Uppercase + pre-suffixed, so the normalization (lowercase, strip
        // trailing .local before re-appending) is what's under test.
        hostname: vi.fn(() => 'My-Machine.LOCAL'),
    };
});

const originalEnv = process.env['ATLAS_LAN_ACCESS'];

beforeEach(() => {
    // ensure each test starts with a known env state; individual tests opt in to truthy
    delete process.env['ATLAS_LAN_ACCESS'];
});

afterEach(() => {
    if (originalEnv === undefined) delete process.env['ATLAS_LAN_ACCESS'];
    else process.env['ATLAS_LAN_ACCESS'] = originalEnv;
});

describe('lan-origins', () => {
    it('returns [] when ATLAS_LAN_ACCESS is unset', async () => {
        const { getLanOrigins } = await import('./lan-origins.js');
        expect(getLanOrigins()).toEqual([]);
    });

    it('returns [] when ATLAS_LAN_ACCESS is "false"', async () => {
        process.env['ATLAS_LAN_ACCESS'] = 'false';
        const { getLanOrigins } = await import('./lan-origins.js');
        expect(getLanOrigins()).toEqual([]);
    });

    it('returns non-loopback non-link-local IPv4 origins when ATLAS_LAN_ACCESS=true', async () => {
        process.env['ATLAS_LAN_ACCESS'] = 'true';
        const { getLanOrigins } = await import('./lan-origins.js');
        const origins = getLanOrigins();
        expect(origins).toContain('http://192.168.1.50:4000');
        expect(origins).toContain('http://10.0.0.5:4000');
        // the machine's mDNS name rides along, normalized to lowercase with
        // exactly one .local suffix
        expect(origins).toContain('http://my-machine.local:4000');
        // loopback, IPv6, and link-local 169.254.x are filtered out
        expect(origins).not.toContain('http://127.0.0.1:4000');
        expect(origins.some((o) => o.includes('fe80'))).toBe(false);
        expect(origins.some((o) => o.includes('169.254'))).toBe(false);
    });

    it('accepts "1" as truthy for ATLAS_LAN_ACCESS', async () => {
        process.env['ATLAS_LAN_ACCESS'] = '1';
        const { getLanOrigins } = await import('./lan-origins.js');
        expect(getLanOrigins().length).toBeGreaterThan(0);
    });

    it('getAllowedOrigins always includes the two static localhost origins', async () => {
        const { getAllowedOrigins } = await import('./lan-origins.js');
        expect(getAllowedOrigins()).toEqual([
            'http://localhost:4000',
            'http://127.0.0.1:4000',
        ]);
    });

    it('getAllowedOrigins appends LAN origins when the env is on', async () => {
        process.env['ATLAS_LAN_ACCESS'] = 'true';
        const { getAllowedOrigins } = await import('./lan-origins.js');
        const allowed = getAllowedOrigins();
        expect(allowed).toContain('http://localhost:4000');
        expect(allowed).toContain('http://127.0.0.1:4000');
        expect(allowed).toContain('http://192.168.1.50:4000');
    });

    it('getTrustedBrowserOrigins returns a Set with the same entries', async () => {
        process.env['ATLAS_LAN_ACCESS'] = 'true';
        const { getTrustedBrowserOrigins } = await import('./lan-origins.js');
        const trusted = getTrustedBrowserOrigins();
        expect(trusted.has('http://localhost:4000')).toBe(true);
        expect(trusted.has('http://127.0.0.1:4000')).toBe(true);
        expect(trusted.has('http://192.168.1.50:4000')).toBe(true);
    });
});
