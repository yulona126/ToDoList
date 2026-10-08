/**
 * API DTOs — mirror of `docs/api.md` §0–§5.
 *
 * Rules of this file:
 *  - field names are exactly the wire names from the contract (snake_case);
 *  - no `any`: unknown payloads get narrowed at the edge (see `lib/api.ts`);
 *  - every entity here has a matching serializer in `backend/apps/*`.
 */
import type {
  BulkAction,
  DueFilter,
  MemberRole,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkspaceVisibility,
} from '../lib/constants';

export type ID = number;

/* ------------------------------------------------------------------ §1 auth */

export interface User {
  id: ID;
  email: string;
  username: string;
  display_name: string;
  /**
   * Read-only display label produced by the server:
   * `display_name || username`. Use this for anything user-facing instead of
   * re-deriving the fallback on the client.
   */
  name: string;
  /** ISO 8601 UTC */
  date_joined: string;
}

export interface AuthResponse {
  user: User;
  access: string;
  refresh: string;
}

/** `POST /auth/refresh/` — refresh tokens rotate, so both come back. */
export interface TokenPair {
  access: string;
  refresh: string;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  password_confirm: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface UpdateProfilePayload {
  username?: string;
  display_name?: string;
}

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
}

/* ------------------------------------------------------ §0.1 pagination shell */

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/* ------------------------------------------------------------- §2 workspaces */

export interface WorkspaceStats {
  total: number;
  todo: number;
  doing: number;
  blocked: number;
  done: number;
  overdue: number;
}

export interface Workspace {
  id: ID;
  name: string;
  description: string;
  visibility: WorkspaceVisibility;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Present on list/detail reads; the caller's role in this workspace. */
  role: MemberRole;
  stats: WorkspaceStats;
}

export interface WorkspaceCreatePayload {
  name: string;
  description?: string;
  sort_order?: number;
}

export interface WorkspaceUpdatePayload {
  name?: string;
  description?: string;
  sort_order?: number;
  is_archived?: boolean;
}

export interface Member {
  id: ID;
  user: User;
  role: MemberRole;
  joined_at: string;
}

export interface WorkspaceQueryParams {
  include_archived?: boolean;
  ordering?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

/* ---------------------------------------------------------------- §3 lists */

export interface TaskListStats {
  total: number;
  done: number;
}

export interface TaskList {
  id: ID;
  workspace: ID;
  name: string;
  description: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  stats: TaskListStats;
}

export interface TaskListCreatePayload {
  workspace: ID;
  name: string;
  description?: string;
  sort_order?: number;
}

export interface TaskListUpdatePayload {
  name?: string;
  description?: string;
  sort_order?: number;
  is_archived?: boolean;
}

export interface ListQueryParams {
  workspace: ID;
  include_archived?: boolean;
  ordering?: string;
}

export interface ReorderItem {
  id: ID;
  sort_order: number;
  task_list?: ID | null;
}

export interface ReorderPayload {
  items: ReorderItem[];
}

export interface ReorderResult {
  updated: number;
}

/* ---------------------------------------------------------------- §4 tasks */

export interface Tag {
  id: ID;
  workspace: ID;
  name: string;
  /** Read-only aggregate; absent on freshly created tags. */
  task_count?: number;
  created_at: string;
}

export interface TagCreatePayload {
  workspace: ID;
  name: string;
}

export interface SubTaskStats {
  total: number;
  done: number;
}

export interface Task {
  id: ID;
  workspace: ID;
  task_list: ID | null;
  /** Denormalised labels returned by the list serializer. */
  workspace_name: string;
  task_list_name: string | null;
  parent: ID | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: TaskType;
  /** `YYYY-MM-DD` or null. */
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
  is_archived: boolean;
  /** Server-computed: `due_date < today AND status != done`. */
  is_overdue: boolean;
  tags: Tag[];
  subtask_stats: SubTaskStats;
  created_at: string;
  updated_at: string;
}

export interface TaskCreatePayload {
  workspace: ID;
  task_list?: ID | null;
  parent?: ID | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  task_type?: TaskType;
  due_date?: string | null;
  tag_ids?: ID[];
}

export type TaskUpdatePayload = Partial<TaskCreatePayload>;

export interface BulkPayload {
  ids: ID[];
  action: BulkAction;
}

export interface BulkResult {
  updated: number;
}

export interface DeleteResult {
  detail?: string;
  deleted_subtasks?: number;
}

/**
 * Query params accepted by `GET /tasks/` (docs/api.md §4).
 * `parent: 'any'` means "do not send the param" (all tasks, sub-tasks included).
 */
export interface TaskQueryParams {
  workspace: ID;
  task_list?: ID | null;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  task_type?: TaskType[];
  tag?: ID[];
  parent?: ID | null | 'any';
  due?: DueFilter;
  is_archived?: boolean;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

/* ------------------------------------------------------------------ §6 health */

export interface HealthStatus {
  status: 'ok' | 'error';
  db: string;
  version: string;
}
