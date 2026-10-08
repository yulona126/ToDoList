import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateTask,
  useDeleteTask,
  useToggleTask,
} from '../../hooks/useTasks';
import { useSubtasks } from '../../hooks/useSubtasks';
import { toApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { Task } from '../../types';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Spinner } from '../ui/Spinner';

export interface SubTaskListProps {
  /** Parent task; its `id` is sent as `parent` on create. */
  task: Task;
}

/**
 * Sub-tasks are one level deep only (api.md §4) and are fetched lazily with
 * `?parent={id}` — the list serializer never inlines them.
 */
export function SubTaskList({ task }: SubTaskListProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const subtasksQuery = useSubtasks(task.workspace, task.id);
  const toggleTask = useToggleTask();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const [draft, setDraft] = useState('');

  const subtasks = subtasksQuery.data?.results ?? [];

  const reportError = (error: unknown): void => {
    push({ type: 'error', message: toApiError(error).detail });
  };

  const handleAdd = async (): Promise<void> => {
    const title = draft.trim();
    if (!title) return;
    try {
      await createTask.mutateAsync({
        workspace: task.workspace,
        task_list: task.task_list,
        parent: task.id,
        title,
      });
      setDraft('');
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="mb-1 ml-9 border-l border-border pl-3">
      {subtasksQuery.isPending ? (
        <div className="flex items-center gap-2 py-1.5 text-meta text-fg-subtle">
          <Spinner size={12} />
          {t('common.loading')}
        </div>
      ) : null}

      {subtasks.map((subtask) => {
        const done = subtask.status === 'done';
        return (
          <div
            key={subtask.id}
            className="group flex min-h-[36px] items-center gap-2 rounded-control px-1 hover:bg-surface-muted"
          >
            <Checkbox
              checked={done}
              status={subtask.status}
              label={done ? t('common.markTodo') : t('common.markDone')}
              onChange={() => {
                toggleTask.mutate(subtask, { onError: reportError });
              }}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-secondary text-fg',
                done && 'line-through opacity-55',
              )}
            >
              {subtask.title}
            </span>
            <IconButton
              label={t('common.delete')}
              size="sm"
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              onClick={() => {
                deleteTask.mutate(subtask.id, { onError: reportError });
              }}
            >
              <Icon name="trash" size={12} />
            </IconButton>
          </div>
        );
      })}

      {!subtasksQuery.isPending && subtasks.length === 0 ? (
        <p className="py-1 text-meta text-fg-subtle">{t('task.subtaskEmpty')}</p>
      ) : null}

      <form
        className="flex items-center gap-2 py-1"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAdd();
        }}
      >
        <Icon name="plus" size={12} className="text-fg-subtle" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('task.subtaskPlaceholder')}
          aria-label={t('task.addSubtask')}
          className="h-7 min-w-0 flex-1 border-0 bg-transparent text-secondary text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
        />
        {draft.trim() ? (
          <Button size="sm" type="submit" loading={createTask.isPending}>
            {t('common.add')}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
