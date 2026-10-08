import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { buildListParams, normalizeListParams } from '../lib/queryParams';
import type {
  ListQueryParams,
  Paginated,
  TaskList,
  TaskListCreatePayload,
  TaskListUpdatePayload,
} from '../types';
import { queryKeys } from './queryKeys';

/** `GET /lists/?workspace={id}` — groups on the task board. */
export function useLists(
  workspaceId: number,
  params: Omit<ListQueryParams, 'workspace'> = {},
) {
  const normalized = normalizeListParams({ ...params, workspace: workspaceId });
  return useQuery({
    queryKey: queryKeys.lists.list(normalized),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<TaskList>>('/lists/', {
        params: buildListParams(normalized),
        signal,
      });
      return data;
    },
  });
}

export function useCreateList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TaskListCreatePayload) => {
      const { data } = await api.post<TaskList>('/lists/', payload);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.lists.all });
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}

export function useUpdateList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: TaskListUpdatePayload;
    }) => {
      const { data } = await api.patch<TaskList>(`/lists/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });
}

export function useDeleteList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/lists/${id}/`);
      return id;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.lists.all });
      // Tasks are not deleted, they fall back to "未分组" — refetch them too.
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}
