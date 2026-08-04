import type { SvgIconComponent } from '@mui/icons-material';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import SmartToyRounded from '@mui/icons-material/SmartToyRounded';
import MemoryRounded from '@mui/icons-material/MemoryRounded';
import type { AgentCli } from '@atlas/shared';

// Per-CLI icon, kept apart from `cliPresentation.ts` so label-only consumers
// (filter chips, pickers, the analytics card) don't drag three React icon
// components into their chunk. Import this ONLY where an icon is rendered.
//
// None of these are official marks — MUI ships no Claude, Copilot, or Ollama
// logo. They are deliberate stand-ins: a terminal for Claude Code, a bot for
// Copilot, and a memory chip for Ollama (it runs on your own hardware).
const CLI_ICON: Record<AgentCli, SvgIconComponent> = {
    claude: TerminalRounded,
    copilot: SmartToyRounded,
    ollama: MemoryRounded,
};

export function cliIcon(cli: AgentCli): SvgIconComponent {
    return CLI_ICON[cli];
}
