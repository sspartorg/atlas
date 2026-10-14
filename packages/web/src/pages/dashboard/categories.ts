import type { AgentCategory } from '@atlas/shared';
import type { LabelColorKey } from '../../theme/tokens.js';

// One hue per agent category, shared by the Today timeline and the agent
// roster so a category reads as the same colour everywhere on the page.
export const CATEGORIES: ReadonlyArray<{
    key: AgentCategory;
    label: string;
    color: LabelColorKey;
}> = [
    { key: 'software-dev', label: 'Software dev', color: 'emerald' },
    { key: 'marketing', label: 'Marketing', color: 'rose' },
    { key: 'content', label: 'Content', color: 'indigo' },
    { key: 'design', label: 'Design', color: 'violet' },
];
