import type { IAgentRun } from '@atlas/shared';

const MARKER = '[SIMULATED';

export function isSimulatedRun(
    run: IAgentRun | null | undefined,
    aiEnabled: boolean | undefined,
): boolean {
    if (!run) return false;
    if (run.output_text && run.output_text.startsWith(MARKER)) return true;
    if (run.output_text && run.output_text.length > 0) return false;
    // Only fall back to the global flag once we know its value — while
    // settings is still loading (`aiEnabled === undefined`) we report
    // "not simulated" so the badge doesn't flash on first paint.
    return aiEnabled === false;
}
