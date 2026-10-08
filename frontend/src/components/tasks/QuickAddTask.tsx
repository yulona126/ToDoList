import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLists } from '../../hooks/useLists';
import { useCreateTag, useTags } from '../../hooks/useTags';
import { useCreateTask } from '../../hooks/useTasks';
import { toApiError } from '../../lib/api';
import { localParse } from '../../lib/localParse';
import { todayIso } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { TaskCreatePayload } from '../../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export interface QuickAddTaskProps {
  workspaceId: number;
  /** `null` puts the task in the "未分组" bucket. */
  taskListId: number | null;
  placeholder?: string;
  onCreated?: () => void;
}

/** A marker at a word boundary means "try the rule parser first". */
const MARKER_PATTERN = /(^|\s)[@#!/^]/;

/**
 * One-line task composer pinned to the bottom of every group
 * (architecture §8.3: "inline quick-add at the bottom of each group").
 *
 * Marked-up input (`写登录页 @开发 #api !高 明天`) is resolved by the local rule
 * parser — instantly and for free — and pre-fills list, tags, priority, type and
 * due date (docs/ai-assistant.md §2.2 T1, §3.1). Anything else is kept verbatim
 * as a plain title, which is the behaviour this field always had.
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
  const createTag = useCreateTag();
  const listsQuery = useLists(workspaceId);
  const tagsQuery = useTags(workspaceId);
  const [value, setValue] = useState('');

  /** `#tag` may name a tag that does not exist yet — create it, like the picker. */
  const resolveTagIds = async (names: readonly string[]): Promise<number[]> => {
    const ids: number[] = [];
    for (const name of names) {
      const known = (tagsQuery.data?.results ?? []).find(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      );
      if (known) {
        ids.push(known.id);
        continue;
      }
      try {
        const created = await createTag.mutateAsync({
          workspace: workspaceId,
          name,
        });
        ids.push(created.id);
      } catch {
        // A concurrent creation or a validation failure simply drops the tag.
      }
    }
    return ids;
  };

  const buildPayload = async (raw: string): Promise<TaskCreatePayload> => {
    const fallback: TaskCreatePayload = {
      workspace: workspaceId,
      task_list: taskListId,
      title: raw,
    };
    if (!MARKER_PATTERN.test(raw)) return fallback;

    const lists = listsQuery.data?.results ?? [];
    const result = localParse(raw, {
      lists,
      tags: tagsQuery.data?.results ?? [],
      today: todayIso(),
      unknownListLabel: t('ai.warnings.listNotFound'),
    });
    const draft = result.drafts[0];
    if (!draft || !draft.t) return fallback;

    const listName = draft.listName;
    const list = listName
      ? lists.find((item) => item.name.toLowerCase() === listName.toLowerCase())
      : undefined;
    const tagIds = await resolveTagIds(draft.tagNames);

    return {
      workspace: workspaceId,
      task_list: list ? list.id : taskListId,
      title: draft.t,
      ...(draft.priority ? { priority: draft.priority } : {}),
      ...(draft.taskType ? { task_type: draft.taskType } : {}),
      ...(draft.dueDate ? { due_date: draft.dueDate } : {}),
      ...(tagIds.length > 0 ? { tag_ids: tagIds } : {}),
    };
  };

  const submit = async (): Promise<void> => {
    const raw = value.trim();
    if (!raw) return;
    try {
      await createTask.mutateAsync(await buildPayload(raw));
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
