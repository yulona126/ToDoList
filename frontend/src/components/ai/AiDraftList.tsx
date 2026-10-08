import { useTranslation } from 'react-i18next';
import {
  TASK_PRIORITY_LABEL_KEY,
  TASK_PRIORITY_VALUES,
  TASK_TYPE_LABEL_KEY,
  TASK_TYPE_VALUES,
  type TaskPriority,
  type TaskType,
} from '../../lib/constants';
import { formatShortDate } from '../../lib/utils';
import type { TaskList } from '../../types';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Select, type SelectOption } from '../ui/Select';

/**
 * The editable draft row used by the AI confirmation panel.
 *
 * It deliberately holds both tag ids (authoritative when the server resolved
 * them) and tag names (what the user sees and edits). Editing the tag field
 * clears the ids so the names are resolved again at creation time.
 */
export interface CaptureDraft {
  id: string;
  selected: boolean;
  expanded: boolean;
  title: string;
  listId: number | null;
  listName: string | null;
  priority: TaskPriority | null;
  taskType: TaskType | null;
  dueDate: string | null;
  tagIds: number[];
  tagNames: string[];
  /** Read-only: sub-tasks the model suggested for this draft. */
  subtasks: string[];
}

export interface AiDraftListProps {
  drafts: readonly CaptureDraft[];
  lists: readonly TaskList[];
  onChange: (id: string, patch: Partial<CaptureDraft>) => void;
}

function splitTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * The one-line meta summary used by both the editable list and the instant
 * local-parse chips: `清单 · 类型 · 优先级 · 到期 · #标签`.
 */
export function captureDraftMeta(
  draft: CaptureDraft,
  translate: (key: string) => string,
): string[] {
  const parts: string[] = [];
  if (draft.listName) parts.push(draft.listName);
  if (draft.taskType) parts.push(translate(TASK_TYPE_LABEL_KEY[draft.taskType]));
  if (draft.priority) {
    parts.push(translate(TASK_PRIORITY_LABEL_KEY[draft.priority]));
  }
  if (draft.dueDate) parts.push(formatShortDate(draft.dueDate));
  for (const tag of draft.tagNames) parts.push(`#${tag}`);
  return parts;
}

export function AiDraftList({ drafts, lists, onChange }: AiDraftListProps) {
  const { t } = useTranslation();

  const noneOption: SelectOption = { value: '', label: t('ai.none') };
  const listOptions: SelectOption[] = [
    noneOption,
    ...lists.map((list) => ({ value: String(list.id), label: list.name })),
  ];
  const priorityOptions: SelectOption[] = [
    noneOption,
    ...TASK_PRIORITY_VALUES.map((value) => ({
      value,
      label: t(TASK_PRIORITY_LABEL_KEY[value]),
    })),
  ];
  const typeOptions: SelectOption[] = [
    noneOption,
    ...TASK_TYPE_VALUES.map((value) => ({
      value,
      label: t(TASK_TYPE_LABEL_KEY[value]),
    })),
  ];

  const meta = (draft: CaptureDraft): string[] =>
    captureDraftMeta(draft, (key) => String(t(key)));

  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((draft) => {
        const parts = meta(draft);
        return (
          <li
            key={draft.id}
            className="rounded-control border border-border bg-surface"
          >
            <div className="flex items-start gap-2 px-2 py-2">
              <Checkbox
                checked={draft.selected}
                onChange={(checked) => onChange(draft.id, { selected: checked })}
                label={t('ai.selectDraft', { title: draft.title })}
              />

              <div className="min-w-0 flex-1">
                <p className="text-body break-words text-fg">{draft.title}</p>
                {parts.length > 0 ? (
                  <p className="text-meta break-words text-fg-muted">
                    {parts.join(' · ')}
                  </p>
                ) : null}

                {draft.subtasks.length > 0 ? (
                  <div className="mt-1 border-l border-border pl-2">
                    <p className="text-meta text-fg-subtle">
                      {t('ai.subtaskCount', { total: draft.subtasks.length })}
                    </p>
                    <ul className="flex flex-col">
                      {draft.subtasks.map((subtask, index) => (
                        <li
                          key={`${draft.id}-sub-${index}`}
                          className="text-meta text-fg-muted"
                        >
                          {subtask}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <Button
                size="sm"
                variant="ghost"
                aria-expanded={draft.expanded}
                onClick={() =>
                  onChange(draft.id, { expanded: !draft.expanded })
                }
                iconLeft={
                  <Icon
                    name={draft.expanded ? 'chevron-down' : 'chevron-right'}
                    size={12}
                  />
                }
              >
                {draft.expanded ? t('ai.collapseEdit') : t('ai.expandEdit')}
              </Button>
            </div>

            {draft.expanded ? (
              <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
                <Input
                  label={t('ai.fieldTitle')}
                  value={draft.title}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) =>
                    onChange(draft.id, { title: event.target.value })
                  }
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    label={t('task.listLabel')}
                    value={draft.listId === null ? '' : String(draft.listId)}
                    options={listOptions}
                    onChange={(event) => {
                      const value = event.target.value;
                      const list = lists.find(
                        (item) => String(item.id) === value,
                      );
                      onChange(draft.id, {
                        listId: list ? list.id : null,
                        listName: list ? list.name : null,
                      });
                    }}
                  />
                  <Select
                    label={t('task.priority')}
                    value={draft.priority ?? ''}
                    options={priorityOptions}
                    onChange={(event) =>
                      onChange(draft.id, {
                        priority: (event.target.value || null) as TaskPriority | null,
                      })
                    }
                  />
                  <Select
                    label={t('task.type')}
                    value={draft.taskType ?? ''}
                    options={typeOptions}
                    onChange={(event) =>
                      onChange(draft.id, {
                        taskType: (event.target.value || null) as TaskType | null,
                      })
                    }
                  />
                  <Input
                    type="date"
                    label={t('task.dueDate')}
                    value={draft.dueDate ?? ''}
                    onChange={(event) =>
                      onChange(draft.id, {
                        dueDate: event.target.value || null,
                      })
                    }
                  />
                </div>

                <Input
                  label={t('task.tags')}
                  value={draft.tagNames.join(', ')}
                  hint={t('ai.tagsEditHint')}
                  autoComplete="off"
                  onChange={(event) =>
                    onChange(draft.id, {
                      tagNames: splitTags(event.target.value),
                      tagIds: [],
                    })
                  }
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
