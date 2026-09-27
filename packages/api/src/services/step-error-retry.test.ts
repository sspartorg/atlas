import { describe, expect, it } from 'vitest';
import { isRetryableStepError } from './step-error-retry.js';

describe('isRetryableStepError', () => {
    it.each([
        ['no output at all', null],
        ['the reaper line', '{"type":"system"}\n[ERROR] API restarted before run completed'],
        ['the watchdog line', '[watchdog] run stuck: no output_text in 30 minutes — subprocess presumed dead.'],
        ['a crash exit', '[ERROR] CLI exited with code 1\n\nsocket hang up'],
        ['a rate limit', '[ERROR] CLI exited with code 1\n\n429 Too Many Requests'],
    ])('retries %s', (_why, output) => {
        expect(isRetryableStepError(output)).toBe(true);
    });

    it.each([
        ['the typed ENOENT marker', '[ERROR] [error-kind:cli_not_installed:{"binary":"claude"}] Failed to spawn claude: spawn claude ENOENT'],
        ['an untagged spawn ENOENT', '[ERROR] spawn copilot ENOENT'],
        ['a missing shell command', '[ERROR] CLI exited with code 127\n\nbash: claude: command not found'],
        ['a bad API key', '[ERROR] CLI exited with code 1\n\nInvalid API key · Please run /login'],
        ['a signed-out CLI', '[ERROR] CLI exited with code 1\n\nNot logged in'],
        ['an API authentication error', '{"type":"error","error":{"type":"authentication_error"}}'],
        ['Copilot with no token', 'Error: No authentication information found.'],
        ['an expired OAuth token', 'OAuth token has expired'],
        ['an HTTP 401', 'Request failed: 401 Unauthorized'],
        ['an empty balance', 'Credit balance is too low'],
        ['a missing agent', 'Agent agent-coder is missing or inactive'],
    ])('does not retry %s', (_why, output) => {
        expect(isRetryableStepError(output)).toBe(false);
    });
});
