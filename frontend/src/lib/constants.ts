/**
 * Mirror of the shared enums from `docs/api.md` §0.4 plus the label/ordering
 * mappings the UI needs. Values here are wire values — never translate them.
 */

/* ------------------------------------------------------------------ enums */

export const TaskStatus = {
  Todo: 'todo',
  Doing: 'doing',
  Blocked: 'blocked',
  Done: 'done',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUS_VALUES: readonly TaskStatus[] = [
  TaskStatus.Todo,
  TaskStatus.Doing,
  TaskStatus.Blocked,
  TaskStatus.Done,
];

export const TaskPriority = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Urgent: 'urgent',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];
export const TASK_PRIORITY_VALUES: readonly TaskPriority[] = [
  TaskPriority.Low,
  TaskPriority.Medium,
  TaskPriority.High,
  TaskPriority.Urgent,
];

export const TaskType = {
  Dev: 'dev',
  Meeting: 'meeting',
  Communication: 'communication',
  Design: 'design',
  Research: 'research',
  Other: 'other',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];
export const TASK_TYPE_VALUES: readonly TaskType[] = [
  TaskType.Dev,
  TaskType.Meeting,
  TaskType.Communication,
  TaskType.Design,
  TaskType.Research,
  TaskType.Other,
];

export const WorkspaceVisibility = {
  Private: 'private',
  Shared: 'shared',
} as const;
export type WorkspaceVisibility =
  (typeof WorkspaceVisibility)[keyof typeof WorkspaceVisibility];
export const WORKSPACE_VISIBILITY_VALUES: readonly WorkspaceVisibility[] = [
  WorkspaceVisibility.Private,
  WorkspaceVisibility.Shared,
];

export const MemberRole = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
  Viewer: 'viewer',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export const MEMBER_ROLE_VALUES: readonly MemberRole[] = [
  MemberRole.Owner,
  MemberRole.Admin,
  MemberRole.Member,
  MemberRole.Viewer,
];

/** UI-only convenience for the `due` query param (api.md §4). */
export const DueFilter = {
  All: 'all',
  Today: 'today',
  Week: 'week',
  Overdue: 'overdue',
  None: 'none',
} as const;
export type DueFilter = (typeof DueFilter)[keyof typeof DueFilter];
export const DUE_FILTER_VALUES: readonly DueFilter[] = [
  DueFilter.All,
  DueFilter.Today,
  DueFilter.Week,
  DueFilter.Overdue,
  DueFilter.None,
];

export type BulkAction = 'done' | 'todo' | 'archive' | 'delete';

/* --------------------------------------------------------------- defaults */

export const DEFAULT_TASK_STATUS: TaskStatus = TaskStatus.Todo;
export const DEFAULT_TASK_PRIORITY: TaskPriority = TaskPriority.Medium;
export const DEFAULT_TASK_TYPE: TaskType = TaskType.Dev;
export const DEFAULT_TASK_ORDERING = 'sort_order,created_at';

/** Server-side ordering choices surfaced in the filter bar. */
export interface OrderingOption {
  value: string;
  labelKey: string;
}

export const TASK_ORDERING_OPTIONS: readonly OrderingOption[] = [
  { value: DEFAULT_TASK_ORDERING, labelKey: 'constants.ordering.manual' },
  { value: '-due_date', labelKey: 'constants.ordering.dueDate' },
  { value: '-priority', labelKey: 'constants.ordering.priority' },
  { value: '-created_at', labelKey: 'constants.ordering.createdAt' },
];

/** Ranking used when the client has to sort locally (optimistic inserts). */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  [TaskPriority.Low]: 0,
  [TaskPriority.Medium]: 1,
  [TaskPriority.High]: 2,
  [TaskPriority.Urgent]: 3,
};

/* ------------------------------------------------------------ i18n keys */

export const TASK_STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  [TaskStatus.Todo]: 'constants.status.todo',
  [TaskStatus.Doing]: 'constants.status.doing',
  [TaskStatus.Blocked]: 'constants.status.blocked',
  [TaskStatus.Done]: 'constants.status.done',
};

export const TASK_PRIORITY_LABEL_KEY: Record<TaskPriority, string> = {
  [TaskPriority.Low]: 'constants.priority.low',
  [TaskPriority.Medium]: 'constants.priority.medium',
  [TaskPriority.High]: 'constants.priority.high',
  [TaskPriority.Urgent]: 'constants.priority.urgent',
};

export const TASK_TYPE_LABEL_KEY: Record<TaskType, string> = {
  [TaskType.Dev]: 'constants.taskType.dev',
  [TaskType.Meeting]: 'constants.taskType.meeting',
  [TaskType.Communication]: 'constants.taskType.communication',
  [TaskType.Design]: 'constants.taskType.design',
  [TaskType.Research]: 'constants.taskType.research',
  [TaskType.Other]: 'constants.taskType.other',
};

export const MEMBER_ROLE_LABEL_KEY: Record<MemberRole, string> = {
  [MemberRole.Owner]: 'constants.role.owner',
  [MemberRole.Admin]: 'constants.role.admin',
  [MemberRole.Member]: 'constants.role.member',
  [MemberRole.Viewer]: 'constants.role.viewer',
};

export const WORKSPACE_VISIBILITY_LABEL_KEY: Record<
  WorkspaceVisibility,
  string
> = {
  [WorkspaceVisibility.Private]: 'constants.visibility.private',
  [WorkspaceVisibility.Shared]: 'constants.visibility.shared',
};

export const DUE_FILTER_LABEL_KEY: Record<DueFilter, string> = {
  [DueFilter.All]: 'constants.due.all',
  [DueFilter.Today]: 'constants.due.today',
  [DueFilter.Week]: 'constants.due.week',
  [DueFilter.Overdue]: 'constants.due.overdue',
  [DueFilter.None]: 'constants.due.none',
};

/**
 * Icon name for each task type (design-system §2: "统一 14px 线性风格").
 * Typed as a string union so `lib/` stays free of component imports.
 */
export type TaskTypeIconName =
  | 'code'
  | 'calendar'
  | 'chat'
  | 'design'
  | 'search'
  | 'dot';

export const TASK_TYPE_ICON: Record<TaskType, TaskTypeIconName> = {
  [TaskType.Dev]: 'code',
  [TaskType.Meeting]: 'calendar',
  [TaskType.Communication]: 'chat',
  [TaskType.Design]: 'design',
  [TaskType.Research]: 'search',
  [TaskType.Other]: 'dot',
};

/* -------------------------------------------------------------- app config */

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'zh-CN';

export type Theme = 'light' | 'dark';

export const STORAGE_KEYS = {
  refresh: 'todolist.refresh',
  theme: 'todolist.theme',
  lang: 'todolist.lang',
  installDismissed: 'todolist.install.dismissed',
  sidebarCollapsed: 'todolist.sidebar.collapsed',
} as const;

/** api.md §4 — the server rejects `task_list` / `parent` other than these shapes. */
export const NULL_PARAM = 'null';

export const PAGE_SIZE = 200;
