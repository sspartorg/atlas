import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dotenv at the top level so the mock is in place before any dynamic
// import triggers module-level side effects in load-env.ts.
vi.mock('dotenv', () => ({
    config: vi.fn(() => ({})),
}));

describe('load-env — module side-effects', () => {
    // Each test re-imports the module fresh so the top-level config() call
    // re-executes with the mock state set up by that test.
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('calls dotenv config with a path ending in .env when ATLAS_ENV is not prod', async () => {
        const _consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // Ensure we are in dev mode.
        vi.stubEnv('ATLAS_ENV', 'dev');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({} as any);

        await import('./load-env.js');

        // config must have been called with a path option.
        expect(dotenv.config).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringMatching(/\.env$/) }),
        );
    });

    it('logs success line with mode=dev when load succeeds and ATLAS_ENV is unset', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({} as any); // no error property

        await import('./load-env.js');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mode=dev'));
    });

    it('logs success line containing the env filename on success', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({} as any);

        await import('./load-env.js');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('file=.env'));
    });

    it('logs error when dotenv returns an error object', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({
            error: new Error('file not found'),
        } as any);

        await import('./load-env.js');

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('failed to load'),
        );
    });

    it('error log includes the env filename and the error message', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({
            error: new Error('file not found'),
        } as any);

        await import('./load-env.js');

        const call = errorSpy.mock.calls[0]?.[0] as string;
        expect(call).toContain('.env');
        expect(call).toContain('file not found');
    });

    it('selects .env.prod and logs mode=prod when ATLAS_ENV=prod', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', 'prod');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({} as any);

        await import('./load-env.js');

        // config should be called with a path ending in .env.prod.
        expect(dotenv.config).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringMatching(/\.env\.prod$/) }),
        );
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mode=prod'));
    });

    it('does not call console.error on success', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({} as any);

        await import('./load-env.js');

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not call console.log on error', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubEnv('ATLAS_ENV', '');

        const dotenv = await import('dotenv');
        vi.mocked(dotenv.config).mockReturnValue({
            error: new Error('missing'),
        } as any);

        await import('./load-env.js');

        expect(logSpy).not.toHaveBeenCalled();
    });
});
