import Box from '@mui/material/Box';
import type { IProject, IAgent } from '@atlas/shared';
import {
    DropdownChip,
    FilterPill,
    SearchPillTextField,
    type DropdownOption,
} from './filterPrimitives.js';

export type IssueFilterKey = 'all' | 'story' | 'bug' | 'sub_task' | 'sub_bug' | 'assigned_me';

interface Props {
    filterKey: IssueFilterKey;
    onFilterChange: (k: IssueFilterKey) => void;
    counts: Record<IssueFilterKey, number>;

    projects: IProject[];
    projectFilter: string | null;
    onProjectChange: (id: string | null) => void;

    agents: IAgent[];
    assigneeFilter: string | null;
    onAssigneeChange: (id: string | null) => void;

    statusFilter: string | null;
    onStatusChange: (s: string | null) => void;

    search: string;
    onSearchChange: (next: string) => void;
}

const PRIMARY_CHIPS: Array<{ key: IssueFilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'story', label: 'Stories' },
    { key: 'bug', label: 'Bugs' },
    { key: 'sub_task', label: 'Sub-tasks' },
    { key: 'sub_bug', label: 'Sub-bugs' },
    { key: 'assigned_me', label: 'Assigned to me' },
];

const STATUS_OPTIONS: DropdownOption[] = [
    { value: null, label: 'any' },
    { value: 'draft', label: 'Draft' },
    { value: 'ready', label: 'Ready' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'waiting_for_info', label: 'Waiting for Info' },
    { value: 'in_review', label: 'In Review' },
    { value: 'done', label: 'Done' },
];

export function IssueFiltersBar(props: Props) {
    const {
        filterKey,
        onFilterChange,
        counts,
        projects,
        projectFilter,
        onProjectChange,
        agents,
        assigneeFilter,
        onAssigneeChange,
        statusFilter,
        onStatusChange,
        search,
        onSearchChange,
    } = props;

    const projectOptions: DropdownOption[] = [
        { value: null, label: 'any' },
        ...projects.map((p) => ({ value: p.id, label: p.name })),
    ];

    const assigneeOptions: DropdownOption[] = [
        { value: null, label: 'any' },
        { value: 'owner', label: 'Owner' },
        ...agents
            .filter((w) => w.status === 'active')
            .map((w) => ({ value: w.id, label: w.name })),
    ];

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
                gap: { xs: 4, md: 2 },
                mb: 5,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    rowGap: { md: 2 },
                    flexWrap: { xs: 'nowrap', md: 'wrap' },
                    flex: { md: 1 },
                    minWidth: 0,
                    overflowX: { xs: 'auto', md: 'visible' },
                    pb: { xs: 1, md: 0 },
                    mx: { xs: -3, md: 0 },
                    px: { xs: 3, md: 0 },
                    '&::-webkit-scrollbar': { display: 'none' },
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                    '& > *': { flexShrink: 0 },
                }}
            >
                {PRIMARY_CHIPS.map(({ key, label }) => (
                    <FilterPill
                        key={key}
                        label={label}
                        count={counts[key]}
                        selected={filterKey === key}
                        onClick={() => onFilterChange(key)}
                    />
                ))}

                <DropdownChip
                    label="Project"
                    value={projectFilter}
                    options={projectOptions}
                    onChange={onProjectChange}
                />
                <DropdownChip
                    label="Status"
                    value={statusFilter}
                    options={STATUS_OPTIONS}
                    onChange={onStatusChange}
                />
                <DropdownChip
                    label="Assignee"
                    value={assigneeFilter}
                    options={assigneeOptions}
                    onChange={onAssigneeChange}
                />
            </Box>

            <SearchPillTextField
                label="Search issues"
                value={search}
                onChange={onSearchChange}
            />
        </Box>
    );
}
