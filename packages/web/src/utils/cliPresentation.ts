import { AGENT_CLIS, CLI_LABEL, type AgentCli } from '@atlas/shared';

// Picker/filter options for every CLI, in registry order — the one thing every
// CLI-aware surface in the app shell needs. Labels come from @atlas/shared so
// the API and MCP surfaces read the same strings.
//
// Kept deliberately thin. The two heavier concerns live next door because both
// are needed by exactly one lazy chunk each, and pulling either in here drags
// it into the initial bundle:
//   - icons   -> `cliIcons.ts` (three MUI React components)
//   - accents -> `_TerminalSessionsCard.tsx` (chart-only colours)
export const CLI_OPTIONS: ReadonlyArray<{ value: AgentCli; label: string }> = AGENT_CLIS.map(
    (cli) => ({ value: cli, label: CLI_LABEL[cli] }),
);
