import { useMemo } from 'react';
import { useTasks } from './useTasks.js';
import { useAllSubTasks } from './useSubTasks.js';
import { countQueueDepthByAgent } from '../pages/agents/agentViewModel.js';

export function useQueueDepthByAgent(): Map<string, number> {
    const { data: tasks } = useTasks();
    const { data: subTasks } = useAllSubTasks();
    return useMemo(
        () => countQueueDepthByAgent([...(tasks ?? []), ...subTasks]),
        [tasks, subTasks]
    );
}
