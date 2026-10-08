import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Paginated, Tag, TagCreatePayload, Task } from '../types';
import { queryKeys } from './queryKeys';
import { patchTaskCaches, snapshotTaskCaches, restoreTaskCaches } from './taskCache';

/** `GET /tags/?workspace={id}` */
export function useTags(workspaceId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tags.list(workspaceId),
    enabled: enabled && Number.isFinite(workspaceId) && workspaceId > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<Tag>>('/tags/', {
        params: { workspace: workspaceId },
        signal,
      });
      return data;
    },
  });
}

export function useCreateTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TagCreatePayload) => {
      const { data } = await api.post<Tag>('/tags/', payload);
      return data;
    },
    onSuccess: (tag) => {
      client.setQueryData<Paginated<Tag>>(
        queryKeys.tags.list(tag.workspace),
        (current) =>
          current
            ? { ...current, count: current.count + 1, results: [...current.results, tag] }
            : current,
      );
      void client.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}

/**
 * `DELETE /tags/{id}/` — the server unbinds the tag from every task, so the
 * optimistic step strips it from the task caches as well.
 */
export function useDeleteTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (tag: Tag) => {
      await api.delete(`/tags/${tag.id}/`);
      return tag;
    },
    onMutate: async (tag) => {
      await client.cancelQueries({ queryKey: queryKeys.tags.all });
      await client.cancelQueries({ queryKey: queryKeys.tasks.all });

      const tagsSnapshot = client.getQueryData<Paginated<Tag>>(
        queryKeys.tags.list(tag.workspace),
      );
      const taskSnapshot = snapshotTaskCaches(client);

      client.setQueryData<Paginated<Tag>>(
        queryKeys.tags.list(tag.workspace),
        (current) =>
          current
            ? {
                ...current,
                count: Math.max(0, current.count - 1),
                results: current.results.filter((item) => item.id !== tag.id),
              }
            : current,
      );

      const collections = client.getQueriesData<Paginated<Task>>({
        queryKey: queryKeys.tasks.listPrefix,
      });
      for (const [, collection] of collections) {
        for (const task of collection?.results ?? []) {
          if (task.tags.some((item) => item.id === tag.id)) {
            patchTaskCaches(client, task.id, {
              tags: task.tags.filter((item) => item.id !== tag.id),
            });
          }
        }
      }

      return { tagsSnapshot, taskSnapshot };
    },
    onError: (_error, tag, context) => {
      if (!context) return;
      client.setQueryData(queryKeys.tags.list(tag.workspace), context.tagsSnapshot);
      restoreTaskCaches(client, context.taskSnapshot);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tags.all });
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}
