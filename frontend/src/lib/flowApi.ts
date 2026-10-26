import { api } from './api';
import type { FlowSummary, Task, TaskEventList } from '../types';

/** `GET /flow/?workspace=` — derived metrics, one call, no user input. */
export async function fetchFlow(workspaceId: number): Promise<FlowSummary> {
  const { data } = await api.get<FlowSummary>('/flow/', {
    params: { workspace: workspaceId },
  });
  return data;
}

/** The story timeline: every event plus a lead-time summary. */
export async function fetchTaskEvents(taskId: number): Promise<TaskEventList> {
  const { data } = await api.get<TaskEventList>(`/tasks/${taskId}/events/`);
  return data;
}

/** Pull into "Now". Idempotent server-side. */
export async function commitTask(taskId: number): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${taskId}/commit/`);
  return data;
}

/** Send back to the backlog. Idempotent server-side. */
export async function uncommitTask(taskId: number): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${taskId}/uncommit/`);
  return data;
}

/** Move a Now item to another day (null clears it). */
export async function planTask(taskId: number, day: string | null): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${taskId}/plan/`, {
    planned_for: day,
  });
  return data;
}
