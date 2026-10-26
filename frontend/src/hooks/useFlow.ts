import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  commitTask,
  fetchFlow,
  fetchTaskEvents,
  planTask,
  uncommitTask,
} from '../lib/flowApi';
import { queryKeys } from './queryKeys';
import type { Task } from '../types';

/**
 * Flow metrics. `staleTime` is short because the numbers change whenever a task
 * moves, and they are what the user reads instead of reviewing the backlog.
 */
export function useFlow(workspaceId: number) {
  return useQuery({
    queryKey: queryKeys.flow.summary(workspaceId),
    queryFn: () => fetchFlow(workspaceId),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
    staleTime: 15_000,
  });
}

export function useTaskEvents(taskId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.flow.events(taskId),
    queryFn: () => fetchTaskEvents(taskId),
    enabled: enabled && taskId > 0,
    staleTime: 10_000,
  });
}

/**
 * Committing changes three things a stale cache would misreport: the task row,
 * the flow numbers, and the story timeline.
 */
function invalidateAfterMove(client: QueryClient, workspaceId: number, taskId: number) {
  void client.invalidateQueries({ queryKey: queryKeys.tasks.listPrefix });
  void client.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
  void client.invalidateQueries({ queryKey: queryKeys.flow.summary(workspaceId) });
  void client.invalidateQueries({ queryKey: queryKeys.flow.events(taskId) });
}

export function useCommitTask(workspaceId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => commitTask(taskId),
    onSuccess: (_task: Task, taskId: number) =>
      invalidateAfterMove(client, workspaceId, taskId),
  });
}

export function useUncommitTask(workspaceId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => uncommitTask(taskId),
    onSuccess: (_task: Task, taskId: number) =>
      invalidateAfterMove(client, workspaceId, taskId),
  });
}

export function usePlanTask(workspaceId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { taskId: number; day: string | null }) =>
      planTask(payload.taskId, payload.day),
    onSuccess: (_task: Task, payload) => {
      invalidateAfterMove(client, workspaceId, payload.taskId);
      void client.invalidateQueries({ queryKey: queryKeys.tasks.listPrefix });
    },
  });
}
