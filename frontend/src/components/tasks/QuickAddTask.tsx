import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateTask } from '../../hooks/useTasks';
import { toApiError } from '../../lib/api';
import { useUI } from '../../stores/UIContext';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export interface QuickAddTaskProps {
  workspaceId: number;
  /** `null` puts the task in the "未分组" bucket. */
  taskListId: number | null;
  placeholder?: string;
  onCreated?: () => void;
}

/**
 * One-line task composer pinned to the bottom of every group
 * (architecture §8.3: "inline quick-add at the bottom of each group").
 */
export function QuickAddTask({
  workspaceId,
  taskListId,
  placeholder,
  onCreated,
}: QuickAddTaskProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const createTask = useCreateTask();
  const [value, setValue] = useState('');

  const submit = async (): Promise<void> => {
    const title = value.trim();
    if (!title) return;
    try {
      await createTask.mutateAsync({
        workspace: workspaceId,
        task_list: taskListId,
        title,
      });
      setValue('');
      onCreated?.();
    } catch (error) {
      push({ type: 'error', message: toApiError(error).detail });
    }
  };

  return (
    <form
      className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-surface-muted"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Icon name="plus" size={14} className="text-fg-subtle" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? t('list.addPlaceholder')}
        aria-label={t('task.new')}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
      />
      {value.trim() ? (
        <Button size="sm" type="submit" loading={createTask.isPending}>
          {t('common.add')}
        </Button>
      ) : null}
    </form>
  );
}
