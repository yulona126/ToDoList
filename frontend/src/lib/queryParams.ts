import {
  DEFAULT_TASK_ORDERING,
  NULL_PARAM,
  PAGE_SIZE,
} from './constants';
import type {
  DocumentQueryParams,
  ListQueryParams,
  TaskQueryParams,
  WorkspaceQueryParams,
} from '../types';

export type QueryParams = Record<string, string>;

/**
 * `TaskQueryParams` → wire query params for `GET /tasks/` (api.md §4).
 *
 * `null` is meaningful for `task_list` and `parent`: it means "the ungrouped
 * bucket" / "top-level only", and is sent as the literal string `null`.
 * `parent: 'any'` means "omit the parameter" (all tasks).
 */
export function buildTaskParams(params: TaskQueryParams): QueryParams {
  const query: QueryParams = { workspace: String(params.workspace) };

  if (params.task_list !== undefined) {
    query.task_list =
      params.task_list === null ? NULL_PARAM : String(params.task_list);
  }
  if (params.status?.length) query.status = params.status.join(',');
  if (params.priority?.length) query.priority = params.priority.join(',');
  if (params.task_type?.length) query.task_type = params.task_type.join(',');
  if (params.tag?.length) query.tag = params.tag.join(',');
  if (params.parent !== undefined && params.parent !== 'any') {
    query.parent = params.parent === null ? NULL_PARAM : String(params.parent);
  }
  if (params.due && params.due !== 'all') query.due = params.due;
  if (params.search?.trim()) query.search = params.search.trim();
  if (params.is_archived !== undefined) {
    query.is_archived = String(params.is_archived);
  }
  query.ordering = params.ordering ?? DEFAULT_TASK_ORDERING;
  query.page_size = String(params.page_size ?? PAGE_SIZE);
  if (params.page) query.page = String(params.page);

  return query;
}

export function buildWorkspaceParams(params: WorkspaceQueryParams): QueryParams {
  const query: QueryParams = {};
  if (params.include_archived !== undefined) {
    query.include_archived = String(params.include_archived);
  }
  query.ordering = params.ordering ?? 'sort_order,-created_at';
  if (params.search?.trim()) query.search = params.search.trim();
  query.page_size = String(params.page_size ?? PAGE_SIZE);
  if (params.page) query.page = String(params.page);
  return query;
}

export function buildListParams(params: ListQueryParams): QueryParams {
  const query: QueryParams = { workspace: String(params.workspace) };
  if (params.include_archived !== undefined) {
    query.include_archived = String(params.include_archived);
  }
  query.ordering = params.ordering ?? 'sort_order,created_at';
  return query;
}

function sortedCopy<T extends string | number>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Canonical form of a task query.
 *
 * Used for BOTH the request and the query key, so two logically identical
 * filters can never occupy two cache entries (`['a','b']` vs `['b','a']`).
 */
export function normalizeTaskParams(params: TaskQueryParams): TaskQueryParams {
  const next: TaskQueryParams = {
    workspace: params.workspace,
    ordering: params.ordering ?? DEFAULT_TASK_ORDERING,
    page_size: params.page_size ?? PAGE_SIZE,
    is_archived: params.is_archived ?? false,
  };

  if (params.task_list !== undefined) next.task_list = params.task_list;
  if (params.parent !== undefined) next.parent = params.parent;
  if (params.status?.length) next.status = sortedCopy(params.status);
  if (params.priority?.length) next.priority = sortedCopy(params.priority);
  if (params.task_type?.length) next.task_type = sortedCopy(params.task_type);
  if (params.tag?.length) next.tag = sortedCopy(params.tag);
  if (params.due && params.due !== 'all') next.due = params.due;
  if (params.search?.trim()) next.search = params.search.trim();
  if (params.page) next.page = params.page;

  return next;
}

export function normalizeWorkspaceParams(
  params: WorkspaceQueryParams,
): WorkspaceQueryParams {
  const next: WorkspaceQueryParams = {
    ordering: params.ordering ?? 'sort_order,-created_at',
    page_size: params.page_size ?? PAGE_SIZE,
    include_archived: params.include_archived ?? false,
  };
  if (params.search?.trim()) next.search = params.search.trim();
  if (params.page) next.page = params.page;
  return next;
}

export function normalizeListParams(params: ListQueryParams): ListQueryParams {
  return {
    workspace: params.workspace,
    ordering: params.ordering ?? 'sort_order,created_at',
    include_archived: params.include_archived ?? false,
  };
}

export function buildDocumentParams(params: DocumentQueryParams): QueryParams {
  const query: QueryParams = { workspace: String(params.workspace) };
  if (params.kind?.length) query.kind = params.kind.join(',');
  if (params.status?.length) query.status = params.status.join(',');
  if (params.tag?.length) query.tag = params.tag.join(',');
  if (params.search?.trim()) query.search = params.search.trim();
  if (params.include_archived !== undefined) {
    query.include_archived = String(params.include_archived);
  }
  query.ordering = params.ordering ?? 'sort_order,-updated_at';
  query.page_size = String(params.page_size ?? PAGE_SIZE);
  if (params.page) query.page = String(params.page);
  return query;
}

export function normalizeDocumentParams(
  params: DocumentQueryParams,
): DocumentQueryParams {
  const next: DocumentQueryParams = {
    workspace: params.workspace,
    ordering: params.ordering ?? 'sort_order,-updated_at',
    page_size: params.page_size ?? PAGE_SIZE,
    include_archived: params.include_archived ?? false,
  };
  if (params.kind?.length) next.kind = sortedCopy(params.kind);
  if (params.status?.length) next.status = sortedCopy(params.status);
  if (params.tag?.length) next.tag = sortedCopy(params.tag);
  if (params.search?.trim()) next.search = params.search.trim();
  if (params.page) next.page = params.page;
  return next;
}
