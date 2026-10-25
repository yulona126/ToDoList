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
  DocumentKind,
  DocumentStatus,
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

/* ---------------------------------------------------- §2.1 architecture */

export type ArchitecturePreferred = 'mermaid' | 'image';

export interface ArchitectureDiagram {
  workspace: ID;
  title: string;
  mermaid: string;
  image_url: string | null;
  preferred: ArchitecturePreferred;
  has_content: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ArchitectureUpdatePayload {
  title?: string;
  mermaid?: string;
  preferred?: ArchitecturePreferred;
}

/* ------------------------------------------------------------ §5 documents */

export interface Document {
  id: ID;
  workspace: ID;
  workspace_name: string;
  title: string;
  /** Markdown body stored in the database. */
  body: string;
  kind: DocumentKind;
  status: DocumentStatus;
  /** Optional relative path when the same doc also lives in a git repo. */
  path: string;
  sort_order: number;
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface DocumentCreatePayload {
  workspace: ID;
  title: string;
  body?: string;
  kind?: DocumentKind;
  status?: DocumentStatus;
  path?: string;
  sort_order?: number;
  tag_ids?: ID[];
}

export type DocumentUpdatePayload = Partial<
  Omit<DocumentCreatePayload, 'workspace'>
> & {
  workspace?: ID;
};

export interface DocumentQueryParams {
  workspace: ID;
  kind?: DocumentKind[];
  status?: DocumentStatus[];
  tag?: ID[];
  search?: string;
  include_archived?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
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
  /** Set when the task was pulled into "Now"; null = backlog. */
  committed_at: string | null;
  is_committed: boolean;
  /** Days since capture — the backlog-aging signal (derived server-side). */
  age_days: number;
  /** Days since it entered "Now"; null while in the backlog. */
  now_days: number | null;
  /** Who is responsible; must be a workspace member. */
  assignee: ID | null;
  assignee_detail: User | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------- §9 story flow */

export type TaskEventKind =
  | 'created'
  | 'committed'
  | 'uncommitted'
  | 'completed'
  | 'reopened'
  | 'blocked'
  | 'unblocked'
  | 'moved'
  | 'noted';

export type TaskEventSource = 'ui' | 'mcp' | 'system';

export interface TaskEvent {
  id: ID;
  kind: TaskEventKind;
  kind_label: string;
  source: TaskEventSource;
  note: string;
  from_value: string;
  to_value: string;
  created_at: string;
}

export interface StorySummary {
  lead_time_hours: number | null;
  active_hours: number | null;
  event_count: number;
  blocked_ever: boolean;
  has_test_note: boolean;
}

export interface TaskEventList {
  count: number;
  results: TaskEvent[];
  summary: StorySummary;
}

/**
 * `GET /flow/?workspace=` — every number is derived, so reading it costs the
 * user nothing. `message` is the one actionable sentence.
 */
export interface FlowSummary {
  workspace: ID;
  now: number;
  backlog: number;
  done_this_week: number;
  wip_limit: number;
  wip_exceeded: boolean;
  wip_headroom: number;
  throughput_per_week: number[];
  oldest_backlog_days: number;
  oldest_now_days: number;
  stale_backlog: number;
  backlog_aging_days: number;
  overdue: number;
  undated_percent: number;
  message: string;
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
  assignee?: ID | null;
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

/* --------------------------------------------------------------- §AI assistant */

/**
 * `docs/ai-assistant.md` §5 — the AI credential row exposed to the browser.
 * The plaintext key NEVER crosses this boundary: `key_mask` is all the UI gets.
 */
export interface AiCredential {
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
  /** `sk-****abcd` or `''` when nothing is stored. */
  key_mask: string;
  is_active: boolean;
  last_verified_at: string | null;
  last_error: string;
  /** Model names offered as datalist suggestions; the field stays free text. */
  models_available: string[];
  /** Quota telemetry so the settings page can warn before a call is rejected. */
  tokens_used_today: number;
  daily_token_budget: number;
}

/** `PUT /ai/credential/` — an absent/empty `api_key` means "keep the stored one". */
export interface AiCredentialUpdate {
  api_key?: string;
  provider?: string;
  model?: string;
  base_url?: string;
  is_active?: boolean;
}

/** `POST /ai/credential/test/` — a `max_tokens=1` probe. */
export interface AiCredentialTestResult {
  ok: boolean;
  model: string;
  latency_ms: number;
  error?: string;
}

export type AiParseMode = 'auto' | 'local' | 'ai';

/** `POST /ai/parse/` request. */
export interface AiParseRequest {
  workspace: ID;
  text: string;
  mode?: AiParseMode;
  /** Fallback list when the text does not name one. */
  default_list?: ID;
  default_type?: TaskType;
}

/**
 * One draft exactly as it travels on the wire.
 *
 * The short keys are the model's own JSON shape (T3 in ai-assistant.md §2) that
 * the server echoes back, so they are part of the contract. Components must
 * never read them: `hooks/useAi.ts` maps them to camelCase first.
 */
export interface AiDraft {
  /** title */
  t: string;
  /** list id */
  l: ID | null;
  /** list name */
  l_name: string | null;
  /** priority */
  p: TaskPriority | null;
  /** task type (y = type, t is already taken by the title) */
  y: TaskType | null;
  /** due date, `YYYY-MM-DD` */
  d: string | null;
  /** tag ids */
  g: ID[];
  /** tag names */
  g_names: string[];
  /** sub-task titles */
  s: string[];
}

export interface AiWarning {
  code: string;
  message: string;
  value?: string;
}

/** Token accounting straight from the provider's `usage` block (§4.2). */
export interface AiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  total_tokens: number;
}

export interface AiParseResponse {
  source: 'local' | 'ai';
  tasks: AiDraft[];
  warnings: AiWarning[];
  usage: AiUsage | null;
  latency_ms: number;
}

/** `POST /ai/split/` — `{task_id}` in, sub-task titles + usage out (§5). */
export interface AiSplitRequest {
  task_id: ID;
}

export interface AiSplitResponse {
  subtasks: Array<{ t: string }>;
  usage: AiUsage | null;
  latency_ms: number;
}

/** `GET /ai/usage/` — one audit row (§4.2). */
export interface AiUsageRecord {
  id: ID;
  kind: 'parse' | 'split' | 'test' | string;
  model: string;
  ok: boolean;
  /** `local` = resolved by the rule parser, i.e. zero API cost. */
  source: 'local' | 'ai' | string;
  error: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  latency_ms: number;
  /** Tasks that the request ended up creating. */
  created_tasks: number;
  created_at: string;
}

/**
 * `GET /ai/usage/?days=30` — the aggregate window plus the latest 20 rows.
 *
 * `ai_calls` vs `local_calls` and `local_ratio` are the "did we save tokens"
 * metric: a high local ratio means T1 is carrying the daily capture load.
 */
export interface AiUsageSummary {
  days: number;
  ai_calls: number;
  local_calls: number;
  local_ratio: number;
  created_tasks: number;
  /** Token totals for the whole window, with cache hits broken out. */
  tokens: AiUsage;
  tokens_used_today: number;
  quota_remaining: number;
  daily_token_budget: number;
  recent: AiUsageRecord[];
}

/* ------------------------------------------- §5 tasks/bulk-create (AI confirm) */

/**
 * One row of `POST /tasks/bulk-create/`.
 *
 * This endpoint goes beyond `POST /tasks/` on purpose: it takes tag **names**
 * (the server `get_or_create`s them, which is what the `#tag` grammar implies)
 * and nested `subtasks` titles, so a confirmed draft is persisted in one
 * transaction without first resolving ids client-side.
 */
export interface BulkCreateItem {
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
  tag_names?: string[];
  subtasks?: string[];
}

export interface BulkCreatePayload {
  tasks: BulkCreateItem[];
}

export interface BulkCreateResult {
  created: number;
  tasks: Task[];
}

/* ------------------------------------------- §1 auth — API tokens (PAT) */

/**
 * One row of `GET /auth/tokens/` (api.md §1).
 *
 * The plaintext secret is *never* part of this shape: the list endpoint only
 * returns a printable `prefix`, and the full value exists solely in
 * {@link ApiTokenCreateResult}.
 */
export interface ApiToken {
  id: ID;
  name: string;
  /** First characters of the secret, e.g. `tdl_ExAmPlE000` — safe to display. */
  prefix: string;
  is_active: boolean;
  /** ISO 8601 UTC, or `null` when the token has never been used. */
  last_used_at: string | null;
  /** ISO 8601 UTC, or `null` for a token that never expires. */
  expires_at: string | null;
  /** ISO 8601 UTC */
  created_at: string;
}

/** `POST /auth/tokens/` request body; `null`/omitted means "never expires". */
export interface ApiTokenCreatePayload {
  name: string;
  expires_in_days?: number | null;
}

/**
 * `POST /auth/tokens/` response — the **only** payload that carries the
 * plaintext `token`. It is shown once and cannot be retrieved afterwards.
 */
export interface ApiTokenCreateResult extends ApiToken {
  token: string;
}

/** `GET /auth/tokens/` envelope. */
export interface ApiTokenListResult {
  count: number;
  results: ApiToken[];
}


/* ------------------------------------------------------------ §10 sharing */

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceMember {
  id: ID;
  user: User;
  role: WorkspaceRole;
  joined_at: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface WorkspaceInvite {
  id: ID;
  token: string;
  role: WorkspaceRole;
  role_label: string;
  status: InviteStatus;
  status_label: string;
  invited_by_detail: User | null;
  accepted_by_detail: User | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  /** Server-provided path, e.g. `/join/<token>`. */
  accept_path: string;
}

/** Public preview shown on the join page before signing in. */
export interface InvitePreview {
  token: string;
  workspace_name: string;
  workspace_description: string;
  role: WorkspaceRole;
  role_label: string;
  status: InviteStatus;
  invited_by: string;
  expires_at: string;
  is_usable: boolean;
}
