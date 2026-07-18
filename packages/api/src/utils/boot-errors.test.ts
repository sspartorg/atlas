import { vi, describe, it, expect, afterEach } from 'vitest';
import { bootStep } from './boot-errors.js';

describe('bootStep', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    it('returns the resolved value when fn succeeds', async () => {
        const result = await bootStep('label', async () => 42);
        expect(result).toBe(42);
    });

    it('returns a resolved object when fn succeeds', async () => {
        const obj = { a: 1 };
        const result = await bootStep('label', async () => obj);
        expect(result).toBe(obj);
    });

    it('does not touch process.exit or console.error on success', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('ok', async () => 'done');

        expect(exitSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Error path — Error instance with stack
    // -----------------------------------------------------------------------

    it('calls process.exit(1) when fn throws an Error', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('db', async () => {
            throw new Error('connection refused');
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('logs the label in the error message', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('myStep', async () => {
            throw new Error('boom');
        });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('[boot] myStep failed'),
        );
    });

    it('includes err.stack in the console.error call when stack is defined', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const err = new Error('has stack');
        // Node always sets a stack on new Error(); verify it's used.
        expect(err.stack).toBeDefined();

        await bootStep('step', async () => {
            throw err;
        });

        const logged = errorSpy.mock.calls[0]?.[0] as string;
        // err.stack contains the error message and typically 'Error:' + frames.
        expect(logged).toContain(err.stack!);
    });

    // -----------------------------------------------------------------------
    // Error path — Error instance WITHOUT stack (stack deleted)
    // -----------------------------------------------------------------------

    it('falls back to err.message when err.stack is undefined', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const err = new Error('no stack here');
        delete err.stack; // force the ?? branch

        await bootStep('step', async () => {
            throw err;
        });

        const logged = errorSpy.mock.calls[0]?.[0] as string;
        expect(logged).toContain('no stack here');
    });

    it('calls process.exit(1) even when stack is deleted', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const err = new Error('no stack');
        delete err.stack;

        await bootStep('step', async () => {
            throw err;
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // -----------------------------------------------------------------------
    // Error path — non-Error throw (string, number, object)
    // -----------------------------------------------------------------------

    it('calls process.exit(1) when fn throws a non-Error string', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('step', async () => {
            throw 'string error';
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('converts a thrown string via String() and includes it in the log', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('step', async () => {
            throw 'string error';
        });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('string error'),
        );
    });

    it('converts a thrown number via String() and includes it in the log', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('step', async () => {
            throw 42;
        });

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    });

    it('converts a thrown plain object via String() in the log', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('step', async () => {
            throw { toString: () => 'custom-object' };
        });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('custom-object'),
        );
    });

    it('includes the label and "refusing to start" text for non-Error throws', async () => {
        vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootStep('db-connect', async () => {
            throw 'timeout';
        });

        const logged = errorSpy.mock.calls[0]?.[0] as string;
        expect(logged).toContain('[boot] db-connect failed, refusing to start');
    });
});
