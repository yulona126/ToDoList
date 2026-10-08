import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Paginated, Task } from '../types';
import { queryKeys } from './queryKeys';

/**
 * Shared plumbing for the optimistic task mutations.
 *
 * Every cached task collection (a filtered list, or a sub-task list) has the
 * shape `Paginated<Task>`, so one updater can serve all of them. A snapshot is
 * taken before the write and replayed verbatim when the request fails —
 * "immediate feedback, rollback on error" per design-system §3 (Checkbox).
 */

export type TaskCollection = Paginated<Task>;
export type TaskCollectionSnapshot = Array<[QueryKey, TaskCollection | undefined]>;

export interface TaskCacheSnapshot {
  collections: TaskCollectionSnapshot;
  details: Array<[QueryKey, Task | undefined]>;
}

const COLLECTION_PREFIXES: readonly QueryKey[] = [
  queryKeys.tasks.listPrefix,
  queryKeys.tasks.subtasksPrefix,
];

const DETAIL_PREFIX: QueryKey = ['tasks', 'detail'];

export function snapshotTaskCaches(client: QueryClient): TaskCacheSnapshot {
  return {
    collections: COLLECTION_PREFIXES.flatMap((queryKey) =>
      client.getQueriesData<TaskCollection>({ queryKey }),
    ),
    details: client.getQueriesData<Task>({ queryKey: DETAIL_PREFIX }),
  };
}

export function restoreTaskCaches(
  client: QueryClient,
  snapshot: TaskCacheSnapshot,
): void {
  for (const [key, data] of snapshot.collections) {
    client.setQueryData(key, data);
  }
  for (const [key, data] of snapshot.details) {
    client.setQueryData(key, data);
  }
}

function mapCollections(
  client: QueryClient,
  mapper: (tasks: readonly Task[]) => Task[] | null,
): void {
  for (const prefix of COLLECTION_PREFIXES) {
    client.setQueriesData<TaskCollection>({ queryKey: prefix }, (current) => {
      if (!current) return current;
      const next = mapper(current.results);
      if (!next) return current;
      return { ...current, results: next };
    });
  }
}

/** Merge a partial patch into every cached copy of `id`. */
export function patchTaskCaches(
  client: QueryClient,
  id: number,
  patch: Partial<Task>,
): void {
  mapCollections(client, (tasks) => {
    let changed = false;
    const next = tasks.map((task) => {
      if (task.id !== id) return task;
      changed = true;
      return { ...task, ...patch };
    });
    return changed ? next : null;
  });

  client.setQueryData<Task>(queryKeys.tasks.detail(id), (current) =>
    current ? { ...current, ...patch } : current,
  );
}

/** Replace every cached copy of `task` with the server's authoritative version. */
export function replaceTaskCaches(client: QueryClient, task: Task): void {
  mapCollections(client, (tasks) => {
    let changed = false;
    const next = tasks.map((existing) => {
      if (existing.id !== task.id) return existing;
      changed = true;
      return task;
    });
    return changed ? next : null;
  });

  client.setQueryData<Task>(queryKeys.tasks.detail(task.id), task);
}

/** Drop tasks (used by delete and archive). */
export function removeTasksFromCaches(
  client: QueryClient,
  ids: readonly number[],
): void {
  const removing = new Set(ids);
  mapCollections(client, (tasks) => {
    if (!tasks.some((task) => removing.has(task.id))) return null;
    return tasks.filter((task) => !removing.has(task.id));
  });
  for (const id of ids) {
    client.removeQueries({ queryKey: queryKeys.tasks.detail(id) });
  }
}

/**
 * Workspace `stats` power the sidebar counters and list stats power the group
 * headers, so both must be refreshed after any task write (round-trip truth
 * beats trying to recompute counts client-side).
 */
export function invalidateStats(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
  void client.invalidateQueries({ queryKey: queryKeys.lists.all });
}

export function invalidateTasks(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.tasks.all });
}

/** Find a task in any cached collection (used to seed optimistic patches). */
export function findCachedTask(
  client: QueryClient,
  id: number,
): Task | undefined {
  const detail = client.getQueryData<Task>(queryKeys.tasks.detail(id));
  if (detail) return detail;
  for (const prefix of COLLECTION_PREFIXES) {
    const collections = client.getQueriesData<TaskCollection>({
      queryKey: prefix,
    });
    for (const [, data] of collections) {
      const found = data?.results.find((task) => task.id === id);
      if (found) return found;
    }
  }
  return undefined;
}
