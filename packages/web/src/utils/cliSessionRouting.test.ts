import { describe, expect, it } from 'vitest';
import { sessionDetailUrl, isTerminalStatus } from './cliSessionRouting.js';

describe('isTerminalStatus', () => {
    it('returns true for closed', () => {
        expect(isTerminalStatus('closed')).toBe(true);
    });

    it('returns true for errored', () => {
        expect(isTerminalStatus('errored')).toBe(true);
    });

    it('returns false for active', () => {
        expect(isTerminalStatus('active')).toBe(false);
    });

    it('returns false for paused', () => {
        expect(isTerminalStatus('paused')).toBe(false);
    });
});

describe('sessionDetailUrl', () => {
    it('returns history URL for closed sessions', () => {
        expect(sessionDetailUrl({ id: 'abc', status: 'closed' })).toBe('/terminal/abc/history');
    });

    it('returns history URL for errored sessions', () => {
        expect(sessionDetailUrl({ id: 'def', status: 'errored' })).toBe('/terminal/def/history');
    });

    it('returns live URL for active sessions', () => {
        expect(sessionDetailUrl({ id: 'ghi', status: 'active' })).toBe('/terminal/ghi');
    });

    it('returns live URL for paused sessions', () => {
        expect(sessionDetailUrl({ id: 'jkl', status: 'paused' })).toBe('/terminal/jkl');
    });
});
