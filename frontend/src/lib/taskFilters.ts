import {
  DEFAULT_TASK_ORDERING,
  DUE_FILTER_VALUES,
  DueFilter,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  TASK_TYPE_VALUES,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from './constants';

/**
 * The task board keeps its filters in the URL (architecture §8.3), so the view
 * is shareable and survives a reload. This module is the single place that
 * translates URLSearchParams ↔ filter state.
 */
export interface TaskFilterState {
  search: string;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  taskType: TaskType | null;
  tagId: number | null;
  due: DueFilter;
  ordering: string;
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
  search: '',
  status: null,
  priority: null,
  taskType: null,
  tagId: null,
  due: DueFilter.All,
  ordering: DEFAULT_TASK_ORDERING,
};

function pick<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T | null {
  if (!raw) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function readTaskFilters(params: URLSearchParams): TaskFilterState {
  const tagRaw = params.get('tag');
  const tagId = tagRaw !== null && /^\d+$/.test(tagRaw) ? Number(tagRaw) : null;
  const ordering = params.get('ordering');

  return {
    search: params.get('q') ?? '',
    status: pick(params.get('status'), TASK_STATUS_VALUES),
    priority: pick(params.get('priority'), TASK_PRIORITY_VALUES),
    taskType: pick(params.get('type'), TASK_TYPE_VALUES),
    tagId,
    due: pick(params.get('due'), DUE_FILTER_VALUES) ?? DueFilter.All,
    ordering: ordering ?? DEFAULT_TASK_ORDERING,
  };
}

/** Only non-default values are serialised, keeping URLs short and readable. */
export function writeTaskFilters(state: TaskFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.status) params.set('status', state.status);
  if (state.priority) params.set('priority', state.priority);
  if (state.taskType) params.set('type', state.taskType);
  if (state.tagId !== null) params.set('tag', String(state.tagId));
  if (state.due !== DueFilter.All) params.set('due', state.due);
  if (state.ordering !== DEFAULT_TASK_ORDERING) {
    params.set('ordering', state.ordering);
  }
  return params;
}

export function countActiveFilters(state: TaskFilterState): number {
  let total = 0;
  if (state.status) total += 1;
  if (state.priority) total += 1;
  if (state.taskType) total += 1;
  if (state.tagId !== null) total += 1;
  if (state.due !== DueFilter.All) total += 1;
  if (state.ordering !== DEFAULT_TASK_ORDERING) total += 1;
  return total;
}

export function hasAnyFilter(state: TaskFilterState): boolean {
  return countActiveFilters(state) > 0 || state.search.trim().length > 0;
}
