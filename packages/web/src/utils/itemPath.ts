import type { IssueType } from '@atlas/shared';

export function itemPath(type: IssueType, id: string): string {
    return type === 'task' ? `/tasks/${id}` : `/sub-tasks/${id}`;
}
