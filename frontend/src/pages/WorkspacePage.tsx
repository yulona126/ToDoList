import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Icon } from '../components/ui/Icon';
import { AiCaptureModal } from '../components/ai/AiCaptureModal';
import { ListFormModal } from '../components/list/ListFormModal';
import { Button } from '../components/ui/Button';
import { DropdownMenu, type DropdownMenuItem } from '../components/ui/DropdownMenu';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { TaskFilters } from '../components/tasks/TaskFilters';
import { TaskTimelinePanel } from '../components/tasks/TaskTimelinePanel';
import { FlowStrip } from '../components/flow/FlowStrip';
import { TaskFormModal } from '../components/tasks/TaskFormModal';
import { TaskItem } from '../components/tasks/TaskItem';
import { QuickAddTask } from '../components/tasks/QuickAddTask';
import { WorkspaceFormModal } from '../components/workspace/WorkspaceFormModal';
import { MembersPanel } from '../components/workspace/MembersPanel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useDeleteList, useLists } from '../hooks/useLists';
import { useBulkTasks, useDeleteTask, useTasks, useToggleTask } from '../hooks/useTasks';
import { useCommitTask, useFlow, useUncommitTask } from '../hooks/useFlow';
import { useMembers } from '../hooks/useMembers';
import { useAuth } from '../stores/AuthContext';
import { useTags } from '../hooks/useTags';
import { useWorkspace, useDeleteWorkspace } from '../hooks/useWorkspaces';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { toApiError } from '../lib/api';
import {
  TASK_STATUS_LABEL_KEY,
  TASK_STATUS_VALUES,
  type BulkAction,
} from '../lib/constants';
import { focusSearch } from '../lib/focusBus';
import {
  hasAnyFilter,
  readTaskFilters,
  writeTaskFilters,
  type TaskFilterState,
} from '../lib/taskFilters';
import { useUI } from '../stores/UIContext';
import type { Task, TaskList } from '../types';

interface TaskGroup {
  key: string;
  title: string;
  listId: number | null;
  list: TaskList | null;
  tasks: Task[];
}

/**
 * The task board (architecture §8.3): grouped by list + "未分组" bucket,
 * per-group collapse, inline quick-add per group, filter bar, empty states and
 * bulk selection.
 */
export function WorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { push } = useUI();
  const { workspaceId: workspaceIdParam, listId: listIdParam } = useParams<{
    workspaceId: string;
    listId?: string;
  }>();

  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceId = Number(workspaceIdParam);
  const focusedListId = listIdParam ? Number(listIdParam) : null;
  const validWorkspaceId = Number.isFinite(workspaceId) && workspaceId > 0;

  const filters = useMemo(() => readTaskFilters(searchParams), [searchParams]);
  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const workspaceQuery = useWorkspace(validWorkspaceId ? workspaceId : 0);
  const listsQuery = useLists(validWorkspaceId ? workspaceId : 0);
  const tagsQuery = useTags(validWorkspaceId ? workspaceId : 0);
  const flowQuery = useFlow(validWorkspaceId ? workspaceId : 0);
  const membersQuery = useMembers(validWorkspaceId ? workspaceId : 0);
  const { user } = useAuth();
  const commitTask = useCommitTask(workspaceId);
  const uncommitTask = useUncommitTask(workspaceId);
  const tasksQuery = useTasks({
    workspace: workspaceId,
    // `parent: null` → "top-level only" (api.md §4), which is what the board
    // shows. `task_list` must be OMITTED when nothing is focused: sending the
    // literal `null` means "the ungrouped bucket only", which would hide every
    // task that lives inside a list.
    parent: null,
    task_list: focusedListId ?? undefined,
    status: filters.status ? [filters.status] : undefined,
    priority: filters.priority ? [filters.priority] : undefined,
    task_type: filters.taskType ? [filters.taskType] : undefined,
    tag: filters.tagId !== null ? [filters.tagId] : undefined,
    due: filters.due,
    search: debouncedSearch || undefined,
    ordering: filters.ordering,
  });

  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const bulkTasks = useBulkTasks();
  const deleteListMutation = useDeleteList();
  const deleteWorkspaceMutation = useDeleteWorkspace();

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [createListId, setCreateListId] = useState<number | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [pendingListDelete, setPendingListDelete] = useState<TaskList | null>(
    null,
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceDeleteOpen, setWorkspaceDeleteOpen] = useState(false);
  const [aiCaptureOpen, setAiCaptureOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [timelineTask, setTimelineTask] = useState<Task | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  /* The roster is the source of truth for permissions: the owner may have
     granted someone admin, and a viewer must not see management controls. */
  const myRole = useMemo(() => {
    const rows = membersQuery.data ?? [];
    return rows.find((row) => row.user.id === user?.id)?.role ?? null;
  }, [membersQuery.data, user?.id]);
  const canManageMembers = myRole === 'owner' || myRole === 'admin';

  const reportError = useCallback(
    (error: unknown) => {
      push({ type: 'error', message: toApiError(error).detail });
    },
    [push],
  );

  const updateFilters = useCallback(
    (patch: Partial<TaskFilterState>) => {
      const next = { ...readTaskFilters(searchParams), ...patch };
      setSearchParams(writeTaskFilters(next), { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const openCreate = useCallback(() => {
    setEditingTask(null);
    setCreateListId(focusedListId);
    setTaskModalOpen(true);
  }, [focusedListId]);

  const handleEscape = useCallback(() => {
    if (filters.search) {
      updateFilters({ search: '' });
      return;
    }
    if (selectedIds.length > 0) {
      setSelectedIds([]);
      setSelectionMode(false);
    }
  }, [filters.search, selectedIds.length, updateFilters]);

  useKeyboardShortcuts({
    onCreateTask: openCreate,
    onFocusSearch: focusSearch,
    onEscape: handleEscape,
  });

  const groups = useMemo<TaskGroup[]>(() => {
    const lists = listsQuery.data?.results ?? [];
    const tasks = tasksQuery.data?.results ?? [];

    const visibleLists =
      focusedListId === null
        ? lists
        : lists.filter((list) => list.id === focusedListId);
    const visibleIds = new Set(visibleLists.map((list) => list.id));

    const result: TaskGroup[] = visibleLists.map((list) => ({
      key: `list-${list.id}`,
      title: list.name,
      listId: list.id,
      list,
      tasks: tasks.filter((task) => task.task_list === list.id),
    }));

    /* Anything without a *loaded* list — no list at all, or a list the API did
       not return (e.g. archived, and `include_archived` defaults to false) —
       falls into the "未分组" bucket so no fetched task can go missing. */
    const ungrouped = tasks.filter(
      (task) => task.task_list === null || !visibleIds.has(task.task_list),
    );

    if (focusedListId === null && (ungrouped.length > 0 || lists.length === 0)) {
      result.push({
        key: 'ungrouped',
        title: t('list.ungrouped'),
        listId: null,
        list: null,
        tasks: ungrouped,
      });
    }
    return result;
  }, [focusedListId, listsQuery.data, t, tasksQuery.data]);

  const runBulk = (action: BulkAction, successKey: string): void => {
    bulkTasks.mutate(
      { ids: selectedIds, action },
      {
        onSuccess: (result) => {
          push({
            type: 'success',
            message: t(successKey, { total: result.updated }),
          });
          setSelectedIds([]);
          setSelectionMode(false);
        },
        onError: reportError,
      },
    );
  };

  if (!validWorkspaceId) {
    return (
      <EmptyState
        icon="compass"
        title={t('workspace.notFound')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('pages.notFoundAction')}
          </Button>
        }
      />
    );
  }

  if (workspaceQuery.isError) {
    return (
      <EmptyState
        icon="alert"
        title={t('workspace.notFound')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('pages.notFoundAction')}
          </Button>
        }
      />
    );
  }

  if (workspaceQuery.isPending) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-fg-subtle"
        role="status"
      >
        <Spinner size={20} />
      </div>
    );
  }

  const workspace = workspaceQuery.data;
  const stats = workspace?.stats;
  const total = tasksQuery.data?.count ?? 0;
  const filtered = hasAnyFilter(filters);

  /* Empty-state decision table (a `null` focus means "the whole workspace"):
     (a) workspace view, tasks exist          → groups
     (b) workspace view, no tasks at all      → onboarding empty state
     (c) workspace view, filters exclude all  → "no matches" empty state
     (d) list focused, list has tasks         → that one group
     (e) list focused, list is empty          → that one group (quick-add visible)
     (f) list focused, list no longer exists  → fall back to the empty state */
  const focusedGroupVisible = focusedListId !== null && groups.length > 0;
  const showEmptyBoard = total === 0 && !filtered && !focusedGroupVisible;
  const showEmptyFiltered = total === 0 && filtered;
  const showGroups = groups.length > 0 && !showEmptyBoard && !showEmptyFiltered;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page-title font-semibold">{workspace?.name}</h1>
          {workspace?.description ? (
            <p className="text-secondary text-fg-muted">
              {workspace.description}
            </p>
          ) : null}
          {stats ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
              <span>{t('common.countTotal', { total: stats.total })}</span>
              {TASK_STATUS_VALUES.map((status) => (
                <span key={status}>
                  {t(TASK_STATUS_LABEL_KEY[status])} {stats[status]}
                </span>
              ))}
              {stats.overdue > 0 ? (
                <span className="font-semibold text-fg">
                  ⌛ {t('task.overdue')} {stats.overdue}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            iconLeft={<Icon name="compass" size={14} />}
            onClick={() => navigate(`/w/${workspaceId}/architecture`)}
          >
            {t('architecture.title')}
          </Button>

          <Button
            variant="secondary"
            iconLeft={<Icon name="file" size={14} />}
            onClick={() => navigate(`/w/${workspaceId}/docs`)}
          >
            {t('document.title')}
          </Button>

          <Button
            variant="secondary"
            iconLeft={<Icon name="compass" size={14} />}
            onClick={() => setMembersOpen(true)}
          >
            {t('members.button')}
            <span className="num ml-1 text-fg-subtle">
              {membersQuery.data?.length ?? 0}
            </span>
          </Button>

          <Button
            variant="primary"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={openCreate}
          >
            {t('task.new')}
          </Button>

          <DropdownMenu
            triggerLabel={t('common.actions')}
            trigger={<Icon name="more-horizontal" size={16} />}
            triggerClassName="border border-border p-1.5"
            items={[
              {
                id: 'edit-workspace',
                label: t('workspace.editTitle'),
                icon: 'edit',
                onSelect: () => setWorkspaceModalOpen(true),
              },
              {
                id: 'delete-workspace',
                label: t('workspace.deleteButton'),
                icon: 'trash',
                separatorBefore: true,
                onSelect: () => setWorkspaceDeleteOpen(true),
              },
            ]}
          />
        </div>
      </header>

      {focusedListId !== null ? (
        <div className="-ml-1">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Icon name="arrow-left" size={16} strokeWidth={1.75} />}
            onClick={() => navigate(`/w/${workspaceId}`)}
          >
            {t('nav.backToWorkspace')}
          </Button>
        </div>
      ) : null}

      <FlowStrip flow={flowQuery.data} isLoading={flowQuery.isPending} />

      <TaskFilters
        filters={filters}
        onChange={updateFilters}
        onReset={resetFilters}
        tags={tagsQuery.data?.results ?? []}
        resultCount={total}
        selectionMode={selectionMode}
        onToggleSelectionMode={() => {
          setSelectionMode((current) => !current);
          setSelectedIds([]);
        }}
        onNewList={() => {
          setEditingList(null);
          setListModalOpen(true);
        }}
        onAiCapture={() => setAiCaptureOpen(true)}
      />

      {selectionMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-3 py-2">
          <span className="text-secondary text-fg">
            {t('common.selectedCount', { total: selectedIds.length })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={selectedIds.length === 0}
              loading={bulkTasks.isPending}
              iconLeft={<Icon name="check" size={13} />}
              onClick={() => runBulk('done', 'task.bulkDoneSuccess')}
            >
              {t('task.bulkDone')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={selectedIds.length === 0}
              iconLeft={<Icon name="trash" size={13} />}
              onClick={() => setBulkDeleteOpen(true)}
            >
              {t('task.bulkDelete')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedIds([]);
                setSelectionMode(false);
              }}
            >
              {t('task.bulkClear')}
            </Button>
          </div>
        </div>
      ) : null}

      {showEmptyBoard ? (
        <EmptyState
          icon="inbox"
          title={t('task.emptyTitle')}
          description={t('task.emptyBody')}
          action={
            <Button
              variant="primary"
              iconLeft={<Icon name="plus" size={14} />}
              onClick={openCreate}
            >
              {t('task.new')}
            </Button>
          }
        />
      ) : null}

      {showEmptyFiltered ? (
        <EmptyState
          icon="search"
          title={t('task.emptyFilteredTitle')}
          description={t('task.emptyFilteredBody')}
          action={
            <Button onClick={resetFilters}>{t('task.resetFilters')}</Button>
          }
        />
      ) : null}

      {showGroups ? (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            const isCollapsed = collapsed[group.key] ?? false;
            const listMenuItems: DropdownMenuItem[] = group.list
              ? [
                  {
                    id: 'edit-list',
                    label: t('list.editTitle'),
                    icon: 'edit',
                    onSelect: () => {
                      setEditingList(group.list);
                      setListModalOpen(true);
                    },
                  },
                  {
                    id: 'delete-list',
                    label: t('common.delete'),
                    icon: 'trash',
                    separatorBefore: true,
                    onSelect: () => setPendingListDelete(group.list),
                  },
                ]
              : [];

            return (
              <section key={group.key}>
                <div className="flex items-center gap-2 border-b border-border px-1 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => ({
                        ...current,
                        [group.key]: !isCollapsed,
                      }))
                    }
                    aria-expanded={!isCollapsed}
                    aria-label={
                      isCollapsed
                        ? t('task.expandGroup')
                        : t('task.collapseGroup')
                    }
                    className="rounded-control p-0.5 text-fg-subtle hover:text-fg"
                  >
                    <Icon
                      name={isCollapsed ? 'chevron-right' : 'chevron-down'}
                      size={12}
                    />
                  </button>

                  <h2 className="text-secondary font-medium text-fg">
                    {group.title}
                  </h2>
                  <span className="text-meta text-fg-subtle tabular-nums">
                    {group.tasks.length}
                  </span>

                  {group.list ? (
                    <span className="ml-auto">
                      <DropdownMenu
                        triggerLabel={t('common.actions')}
                        items={listMenuItems}
                        trigger={<Icon name="more-horizontal" size={14} />}
                        triggerClassName="p-1"
                      />
                    </span>
                  ) : (
                    <span className="ml-auto text-meta text-fg-subtle">
                      {t('list.ungroupedHint')}
                    </span>
                  )}
                </div>

                {!isCollapsed ? (
                  <>
                    <ul className="flex flex-col">
                      {group.tasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onToggle={(target) => {
                            toggleTask.mutate(target, { onError: reportError });
                          }}
                          onEdit={(target) => {
                            setEditingTask(target);
                            setCreateListId(null);
                            setTaskModalOpen(true);
                          }}
                          onDelete={(target) => setPendingDelete(target)}
                          agingDays={flowQuery.data?.backlog_aging_days}
                          onShowTimeline={(target) => setTimelineTask(target)}
                          onCommit={(target) => {
                            commitTask.mutate(target.id, {
                              onError: reportError,
                              onSuccess: () =>
                                push({
                                  type: 'success',
                                  message: t('flow.pulledIn', { title: target.title }),
                                }),
                            });
                          }}
                          onUncommit={(target) => {
                            uncommitTask.mutate(target.id, {
                              onError: reportError,
                              onSuccess: () =>
                                push({
                                  type: 'success',
                                  message: t('flow.sentBack', { title: target.title }),
                                }),
                            });
                          }}
                          selectable={selectionMode}
                          selected={selectedIds.includes(task.id)}
                          onSelectToggle={(target) => {
                            setSelectedIds((current) =>
                              current.includes(target.id)
                                ? current.filter((id) => id !== target.id)
                                : [...current, target.id],
                            );
                          }}
                        />
                      ))}
                    </ul>

                    {group.tasks.length === 0 ? (
                      <p className="px-2 py-1.5 text-meta text-fg-subtle">
                        {t('task.emptyGroup')}
                      </p>
                    ) : null}

                    <QuickAddTask
                      workspaceId={workspaceId}
                      taskListId={group.listId}
                      onCreated={() =>
                        setCollapsed((current) => ({
                          ...current,
                          [group.key]: false,
                        }))
                      }
                    />
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}

      {tasksQuery.isFetching && total > 0 ? (
        <div
          className="flex items-center gap-2 text-meta text-fg-subtle"
          role="status"
        >
          <Spinner size={12} />
          {t('common.loading')}
        </div>
      ) : null}

      <TaskFormModal
        open={taskModalOpen}
        workspaceId={workspaceId}
        task={editingTask}
        defaultListId={createListId}
        onClose={() => {
          setTaskModalOpen(false);
          setEditingTask(null);
        }}
      />

      <ListFormModal
        open={listModalOpen}
        workspaceId={workspaceId}
        list={editingList}
        onClose={() => {
          setListModalOpen(false);
          setEditingList(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('task.deleteConfirmTitle')}
        description={t('task.deleteConfirmBody', {
          title: pendingDelete?.title ?? '',
        })}
        confirmLabel={t('common.delete')}
        confirmVariant="danger"
        loading={deleteTask.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          deleteTask.mutate(target.id, {
            onSuccess: () => {
              push({ type: 'success', message: t('task.deleted') });
              setPendingDelete(null);
            },
            onError: (error) => {
              reportError(error);
              setPendingDelete(null);
            },
          });
        }}
      />

      <ConfirmDialog
        open={pendingListDelete !== null}
        title={t('list.deleteConfirmTitle')}
        description={t('list.deleteConfirmBody', {
          total: pendingListDelete?.stats.total ?? 0,
        })}
        confirmLabel={t('list.deleteButton')}
        confirmVariant="danger"
        loading={deleteListMutation.isPending}
        onCancel={() => setPendingListDelete(null)}
        onConfirm={() => {
          const target = pendingListDelete;
          if (!target) return;
          deleteListMutation.mutate(target.id, {
            onSuccess: () => {
              push({ type: 'success', message: t('list.deleted') });
              setPendingListDelete(null);
              if (focusedListId === target.id) navigate(`/w/${workspaceId}`);
            },
            onError: (error) => {
              reportError(error);
              setPendingListDelete(null);
            },
          });
        }}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t('task.bulkDeleteConfirmTitle')}
        description={t('task.bulkDeleteConfirmBody', {
          total: selectedIds.length,
        })}
        confirmLabel={t('task.bulkDelete')}
        confirmVariant="danger"
        loading={bulkTasks.isPending}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => {
          setBulkDeleteOpen(false);
          runBulk('delete', 'task.bulkDeleteSuccess');
        }}
      />

      <WorkspaceFormModal
        open={workspaceModalOpen}
        workspace={workspace ?? null}
        onClose={() => setWorkspaceModalOpen(false)}
      />

      <AiCaptureModal
        open={aiCaptureOpen}
        workspaceId={workspaceId}
        defaultListId={focusedListId}
        onClose={() => setAiCaptureOpen(false)}
      />

      <TaskTimelinePanel
        task={timelineTask}
        onClose={() => setTimelineTask(null)}
      />

      <MembersPanel
        open={membersOpen}
        workspaceId={workspaceId}
        canManage={canManageMembers}
        currentUserId={user?.id ?? null}
        onClose={() => setMembersOpen(false)}
      />

      <ConfirmDialog
        open={workspaceDeleteOpen}
        title={t('workspace.deleteConfirmTitle')}
        description={t('workspace.deleteConfirmBody', {
          total: stats?.total ?? 0,
        })}
        confirmLabel={t('workspace.deleteButton')}
        confirmVariant="danger"
        loading={deleteWorkspaceMutation.isPending}
        onCancel={() => setWorkspaceDeleteOpen(false)}
        onConfirm={() => {
          deleteWorkspaceMutation.mutate(workspaceId, {
            onSuccess: () => {
              push({ type: 'success', message: t('workspace.deleted') });
              setWorkspaceDeleteOpen(false);
              navigate('/');
            },
            onError: (error) => {
              reportError(error);
              setWorkspaceDeleteOpen(false);
            },
          });
        }}
      />
    </div>
  );
}
