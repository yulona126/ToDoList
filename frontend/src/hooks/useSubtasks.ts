import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { buildTaskParams } from '../lib/queryParams';
import type { Paginated, Task } from '../types';
import { queryKeys } from './queryKeys';

/**
 * `GET /tasks/?workspace=&parent={id}` — sub-tasks are fetched lazily per parent
 * (the list serializer deliberately omits an inline `subtasks` array, api.md §4).
 */
export function useSubtasks(
  workspaceId: number,
  parentId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.tasks.subtasks(workspaceId, parentId ?? 0),
    enabled:
      enabled &&
      parentId !== null &&
      Number.isFinite(workspaceId) &&
      workspaceId > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<Task>>('/tasks/', {
        params: buildTaskParams({
          workspace: workspaceId,
          parent: parentId,
          ordering: 'sort_order,created_at',
        }),
        signal,
      });
      return data;
    },
  });
}
