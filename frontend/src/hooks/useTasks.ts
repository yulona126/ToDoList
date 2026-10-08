import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TaskStatus } from '../lib/constants';
import { buildTaskParams, normalizeTaskParams } from '../lib/queryParams';
import { isOverdue } from '../lib/utils';
import type {
  BulkPayload,
  BulkResult,
  Paginated,
  Tag,
  Task,
  TaskCreatePayload,
  TaskQueryParams,
  TaskUpdatePayload,
} from '../types';
import { queryKeys } from './queryKeys';
import {
  findCachedTask,
  invalidateStats,
  invalidateTasks,
  patchTaskCaches,
  removeTasksFromCaches,
  replaceTaskCaches,
  restoreTaskCaches,
  snapshotTaskCaches,
} from './taskCache';

/** `GET /tasks/` — the task board query. */
export function useTasks(params: TaskQueryParams) {
  const normalized = normalizeTaskParams(params);
  return useQuery({
    queryKey: queryKeys.tasks.list(normalized),
    enabled: Number.isFinite(normalized.workspace) && normalized.workspace > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<Task>>('/tasks/', {
        params: buildTaskParams(normalized),
        signal,
      });
      return data;
    },
  });
}

/**
 * Turn a PATCH payload into the `Partial<Task>` we can render immediately.
 * `tag_ids` are resolved against the cached tag list; `completed_at` and
 * `is_overdue` mirror the server rules from api.md §4.
 */
function optimisticPatch(
  payload: TaskUpdatePayload,
  current: Task | undefined,
  availableTags: readonly Tag[] | undefined,
): Partial<Task> {
  const patch: Partial<Task> = {};

  if (payload.title !== undefined) patch.title = payload.title;
  if (payload.description !== undefined) patch.description = payload.description;
  if (payload.task_list !== undefined) patch.task_list = payload.task_list;
  if (payload.priority !== undefined) patch.priority = payload.priority;
  if (payload.task_type !== undefined) patch.task_type = payload.task_type;

  if (payload.due_date !== undefined) {
    patch.due_date = payload.due_date;
    patch.is_overdue = isOverdue(
      payload.due_date,
      payload.status ?? current?.status ?? 'todo',
    );
  }

  if (payload.status !== undefined) {
    patch.status = payload.status;
    if (payload.status === 'done') {
      if (current?.status !== 'done' || !current.completed_at) {
        patch.completed_at = new Date().toISOString();
      }
    } else {
      patch.completed_at = null;
    }
    patch.is_overdue = isOverdue(
      payload.due_date ?? current?.due_date ?? null,
      payload.status,
    );
  }

  if (payload.tag_ids !== undefined) {
    const known = new Map<number, Tag>();
    for (const tag of availableTags ?? current?.tags ?? []) {
      known.set(tag.id, tag);
    }
    patch.tags = payload.tag_ids.flatMap((id) => {
      const tag = known.get(id);
      return tag ? [tag] : [];
    });
  }

  return patch;
}

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TaskCreatePayload) => {
      const { data } = await api.post<Task>('/tasks/', payload);
      return data;
    },
    onSuccess: (task) => {
      client.setQueryData(queryKeys.tasks.detail(task.id), task);
      invalidateStats(client);
      invalidateTasks(client);
    },
  });
}

/** Optimistic edit with rollback (toggle/edit/delete are the three fast paths). */
export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: TaskUpdatePayload;
    }) => {
      const { data } = await api.patch<Task>(`/tasks/${id}/`, payload);
      return data;
    },
    onMutate: async ({ id, payload }) => {
      await client.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshot = snapshotTaskCaches(client);
      const current = findCachedTask(client, id);
      const workspaceId = payload.workspace ?? current?.workspace;
      const tags = workspaceId
        ? client.getQueryData<Paginated<Tag>>(queryKeys.tags.list(workspaceId))
        : undefined;
      const patch = optimisticPatch(payload, current, tags?.results);
      if (Object.keys(patch).length > 0) {
        patchTaskCaches(client, id, patch);
      }
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot) restoreTaskCaches(client, snapshot);
    },
    onSuccess: (task) => {
      replaceTaskCaches(client, task);
    },
    onSettled: () => {
      invalidateStats(client);
      invalidateTasks(client);
    },
  });
}

export function useDeleteTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tasks/${id}/`);
      return id;
    },
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshot = snapshotTaskCaches(client);
      removeTasksFromCaches(client, [id]);
      return snapshot;
    },
    onError: (_error, _id, snapshot) => {
      if (snapshot) restoreTaskCaches(client, snapshot);
    },
    onSettled: () => {
      invalidateStats(client);
      invalidateTasks(client);
    },
  });
}

/** `POST /tasks/{id}/toggle/` — the check-circle fast path. */
export function useToggleTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const { data } = await api.post<Task>(`/tasks/${task.id}/toggle/`);
      return data;
    },
    onMutate: async (task) => {
      await client.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshot = snapshotTaskCaches(client);
      const markingDone = task.status !== 'done';
      patchTaskCaches(client, task.id, {
        status: markingDone ? 'done' : 'todo',
        completed_at: markingDone ? new Date().toISOString() : null,
      });
      return snapshot;
    },
    onError: (_error, _task, snapshot) => {
      if (snapshot) restoreTaskCaches(client, snapshot);
    },
    onSuccess: (task) => {
      replaceTaskCaches(client, task);
    },
    onSettled: () => {
      invalidateStats(client);
      invalidateTasks(client);
    },
  });
}

/** `POST /tasks/bulk/` — bulk selection on the task board. */
export function useBulkTasks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkPayload) => {
      const { data } = await api.post<BulkResult>('/tasks/bulk/', payload);
      return data;
    },
    onMutate: async ({ ids, action }) => {
      await client.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshot = snapshotTaskCaches(client);

      if (action === 'delete' || action === 'archive') {
        removeTasksFromCaches(client, ids);
      } else {
        const status: TaskStatus = action === 'done' ? 'done' : 'todo';
        const completedAt = action === 'done' ? new Date().toISOString() : null;
        for (const id of ids) {
          patchTaskCaches(client, id, { status, completed_at: completedAt });
        }
      }
      return snapshot;
    },
    onError: (_error, _payload, snapshot) => {
      if (snapshot) restoreTaskCaches(client, snapshot);
    },
    onSettled: () => {
      invalidateStats(client);
      invalidateTasks(client);
    },
  });
}
