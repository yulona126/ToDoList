import type {
  ListQueryParams,
  TaskQueryParams,
  WorkspaceQueryParams,
} from '../types';

/**
 * Single source of truth for every cache key (architecture §8.2: "任何一处的业务
 * 数据都应可通过 queryKey 溯源").
 *
 * Collection prefixes (`workspaces.all`, `tasks.listPrefix`, …) exist so
 * optimistic updates and invalidation can target a whole family of queries.
 */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  workspaces: {
    all: ['workspaces'] as const,
    list: (params: WorkspaceQueryParams = {}) =>
      ['workspaces', 'list', params] as const,
    detail: (id: number) => ['workspaces', 'detail', id] as const,
    members: (id: number) => ['workspaces', 'members', id] as const,
  },
  lists: {
    all: ['lists'] as const,
    list: (params: ListQueryParams) => ['lists', 'list', params] as const,
    detail: (id: number) => ['lists', 'detail', id] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    list: (params: TaskQueryParams) => ['tasks', 'list', params] as const,
    /** Prefix that matches every cached task list. */
    listPrefix: ['tasks', 'list'] as const,
    detail: (id: number) => ['tasks', 'detail', id] as const,
    subtasks: (workspaceId: number, parentId: number) =>
      ['tasks', 'subtasks', workspaceId, parentId] as const,
    /** Prefix that matches every cached sub-task collection. */
    subtasksPrefix: ['tasks', 'subtasks'] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: (workspaceId: number) => ['tags', 'list', workspaceId] as const,
  },
  ai: {
    credential: ['ai', 'credential'] as const,
    usage: (days: number) => ['ai', 'usage', days] as const,
    /** Prefix that matches every usage window (today / 30d / …). */
    usagePrefix: ['ai', 'usage'] as const,
  },
} as const;
