import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TASK_PRIORITY_LABEL_KEY,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_LABEL_KEY,
  TASK_STATUS_VALUES,
  TASK_TYPE_LABEL_KEY,
  TASK_TYPE_VALUES,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../../lib/constants';
import { useLists } from '../../hooks/useLists';
import { useCreateTag, useTags } from '../../hooks/useTags';
import { useCreateTask, useUpdateTask } from '../../hooks/useTasks';
import { fieldError, toApiError, type ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { Tag, Task, TaskCreatePayload } from '../../types';
import { MarkdownPreview } from '../documents/MarkdownPreview';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select, type SelectOption } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

type DescriptionMode = 'edit' | 'preview';

export interface TaskFormModalProps {
  open: boolean;
  workspaceId: number;
  /** Pass a task to edit; omit to create. */
  task?: Task | null;
  /** Pre-selected list for a new task. */
  defaultListId?: number | null;
  /** Set when creating a sub-task. */
  parentId?: number | null;
  onClose: () => void;
}

/** Create + edit task. `Cmd/Ctrl+Enter` submits (design-system §5). */
export function TaskFormModal({
  open,
  workspaceId,
  task = null,
  defaultListId = null,
  parentId = null,
  onClose,
}: TaskFormModalProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const formId = useId();

  const listsQuery = useLists(workspaceId);
  const tagsQuery = useTags(workspaceId, open);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionMode, setDescriptionMode] =
    useState<DescriptionMode>('edit');
  const [taskListId, setTaskListId] = useState<number | null>(null);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.Todo);
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.Medium);
  const [taskType, setTaskType] = useState<TaskType>(TaskType.Dev);
  const [dueDate, setDueDate] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [error, setError] = useState<ApiError | null>(null);

  const pending = createTask.isPending || updateTask.isPending;

  useEffect(() => {
    if (!open) return;
    const nextDescription = task?.description ?? '';
    setTitle(task?.title ?? '');
    setDescription(nextDescription);
    // Open existing tasks with content in preview so Markdown renders immediately.
    setDescriptionMode(
      task && nextDescription.trim() ? 'preview' : 'edit',
    );
    setTaskListId(task ? task.task_list : defaultListId);
    setStatus(task?.status ?? TaskStatus.Todo);
    setPriority(task?.priority ?? TaskPriority.Medium);
    setTaskType(task?.task_type ?? TaskType.Dev);
    setDueDate(task?.due_date ?? '');
    setSelectedTags(task?.tags ?? []);
    setTitleError(undefined);
    setError(null);
  }, [open, task, defaultListId]);

  const listOptions: SelectOption[] = useMemo(() => {
    const lists = listsQuery.data?.results ?? [];
    return [
      { value: '', label: t('task.noList') },
      ...lists.map((list) => ({ value: String(list.id), label: list.name })),
    ];
  }, [listsQuery.data, t]);

  const statusOptions: SelectOption[] = TASK_STATUS_VALUES.map((value) => ({
    value,
    label: t(TASK_STATUS_LABEL_KEY[value]),
  }));
  const priorityOptions: SelectOption[] = TASK_PRIORITY_VALUES.map((value) => ({
    value,
    label: t(TASK_PRIORITY_LABEL_KEY[value]),
  }));
  const typeOptions: SelectOption[] = TASK_TYPE_VALUES.map((value) => ({
    value,
    label: t(TASK_TYPE_LABEL_KEY[value]),
  }));

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(t('validation.titleRequired'));
      return;
    }
    if (trimmed.length > 200) {
      setTitleError(t('validation.titleLength'));
      return;
    }
    setTitleError(undefined);

    const payload: TaskCreatePayload = {
      workspace: workspaceId,
      task_list: taskListId,
      title: trimmed,
      description,
      status,
      priority,
      task_type: taskType,
      due_date: dueDate || null,
      tag_ids: selectedTags.map((tag) => tag.id),
    };

    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, payload });
        push({ type: 'success', message: t('task.updated') });
      } else {
        await createTask.mutateAsync(
          parentId === null ? payload : { ...payload, parent: parentId },
        );
        push({ type: 'success', message: t('task.created') });
      }
      onClose();
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError);
      setTitleError(fieldError(apiError, 'title'));
      push({ type: 'error', message: apiError.detail });
    }
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? t('task.editTitle') : t('task.newTitle')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
          >
            {task ? t('common.save') : t('task.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={handleFormKeyDown}
      >
        <Input
          label={t('task.titleLabel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('task.titlePlaceholder')}
          error={titleError}
          maxLength={200}
          autoComplete="off"
          data-autofocus
        />

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-secondary font-medium text-fg-muted">
              {t('task.description')}
            </span>
            <div
              role="tablist"
              aria-label={t('task.description')}
              className="inline-flex rounded-control border border-border p-0.5"
            >
              {(['edit', 'preview'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={descriptionMode === mode}
                  className={cn(
                    'rounded-[6px] px-2 py-0.5 text-meta motion-safe-150',
                    descriptionMode === mode
                      ? 'bg-surface-muted font-medium text-fg'
                      : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => setDescriptionMode(mode)}
                >
                  {mode === 'edit' ? t('common.edit') : t('common.preview')}
                </button>
              ))}
            </div>
          </div>

          {descriptionMode === 'edit' ? (
            <Textarea
              aria-label={t('task.description')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('task.descriptionPlaceholder')}
              rows={6}
              className="font-mono text-secondary"
              hint={t('task.descriptionHint')}
            />
          ) : (
            <div className="min-h-[120px] rounded-control border border-border bg-surface-muted px-3 py-2.5">
              <MarkdownPreview
                source={description}
                emptyLabel={t('task.descriptionPreviewEmpty')}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t('task.listLabel')}
            value={taskListId === null ? '' : String(taskListId)}
            options={listOptions}
            onChange={(event) =>
              setTaskListId(
                event.target.value ? Number(event.target.value) : null,
              )
            }
          />
          <Select
            label={t('task.status')}
            value={status}
            options={statusOptions}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          />
          <Select
            label={t('task.priority')}
            value={priority}
            options={priorityOptions}
            onChange={(event) =>
              setPriority(event.target.value as TaskPriority)
            }
          />
          <Select
            label={t('task.type')}
            value={taskType}
            options={typeOptions}
            onChange={(event) => setTaskType(event.target.value as TaskType)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Input
            type="date"
            label={t('task.dueDate')}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          {dueDate ? (
            <button
              type="button"
              onClick={() => setDueDate('')}
              className="self-start text-meta text-fg-muted hover:text-fg"
            >
              {t('task.clearDueDate')}
            </button>
          ) : null}
        </div>

        <TagPicker
          workspaceId={workspaceId}
          allTags={tagsQuery.data?.results ?? []}
          selected={selectedTags}
          onChange={setSelectedTags}
        />

        {error && !titleError ? (
          <p role="alert" className="text-meta text-fg">
            {error.detail}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

interface TagPickerProps {
  workspaceId: number;
  allTags: readonly Tag[];
  selected: readonly Tag[];
  onChange: (tags: Tag[]) => void;
}

/**
 * Multi-select tag field with inline creation (`POST /tags/`). Duplicate names
 * are rejected by the server (api.md §5), which we turn into "just select it".
 */
function TagPicker({
  workspaceId,
  allTags,
  selected,
  onChange,
}: TagPickerProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const createTag = useCreateTag();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedIds = new Set(selected.map((tag) => tag.id));
  const normalized = query.trim().toLowerCase();

  const suggestions = allTags.filter(
    (tag) => !selectedIds.has(tag.id) && tag.name.toLowerCase().includes(normalized),
  );
  const exactMatch = allTags.some(
    (tag) => tag.name.toLowerCase() === normalized,
  );
  const canCreate = normalized.length > 0 && !exactMatch;

  const optionCount = suggestions.length + (canCreate ? 1 : 0);

  const addTag = (tag: Tag): void => {
    if (!selectedIds.has(tag.id)) onChange([...selected, tag]);
    setQuery('');
    setActiveIndex(0);
    setOpen(false);
  };

  const commitCreate = async (): Promise<void> => {
    const name = query.trim();
    if (!name) return;
    try {
      const tag = await createTag.mutateAsync({ workspace: workspaceId, name });
      addTag(tag);
      push({ type: 'success', message: t('task.tagCreated') });
    } catch (caught) {
      const existing = allTags.find(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        addTag(existing);
        return;
      }
      push({ type: 'error', message: toApiError(caught).detail });
    }
  };

  const chooseOption = (index: number): void => {
    if (index < suggestions.length) {
      addTag(suggestions[index]);
      return;
    }
    if (canCreate) void commitCreate();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (optionCount === 0) return;
        event.preventDefault();
        setOpen(true);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(
          (current) => (current + delta + optionCount) % optionCount,
        );
        break;
      }
      case 'Enter': {
        if (!open || optionCount === 0) return;
        event.preventDefault();
        chooseOption(activeIndex);
        break;
      }
      case 'Backspace': {
        if (query === '' && selected.length > 0) {
          onChange(selected.slice(0, -1));
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className="relative flex flex-col gap-1">
      <label
        htmlFor={listId}
        className="text-secondary font-medium text-fg-muted"
      >
        {t('task.tags')}
      </label>

      <div
        className={cn(
          'flex min-h-8 flex-wrap items-center gap-1.5 rounded-control border border-border bg-bg px-2 py-1',
          'focus-within:border-fg',
        )}
      >
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-pill border border-border px-1.5 py-0.5 text-meta text-fg"
          >
            <Icon name="tag" size={10} />
            {tag.name}
            <button
              type="button"
              aria-label={`${t('common.remove')} ${tag.name}`}
              onClick={() =>
                onChange(selected.filter((item) => item.id !== tag.id))
              }
              className="rounded-pill text-fg-subtle hover:text-fg"
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}

        <input
          id={listId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-listbox`}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={t('task.tagsPlaceholder')}
          className="h-6 min-w-[120px] flex-1 border-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
        />
      </div>

      {open && optionCount > 0 ? (
        <ul
          id={`${listId}-listbox`}
          role="listbox"
          className="absolute top-[calc(100%+4px)] left-0 z-50 max-h-48 w-full overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-popover"
        >
          {suggestions.map((tag, index) => (
            <li key={tag.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => addTag(tag)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-secondary text-fg',
                  index === activeIndex && 'bg-surface-muted',
                )}
              >
                <Icon name="tag" size={12} className="text-fg-muted" />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              </button>
            </li>
          ))}

          {canCreate ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === suggestions.length}
                onMouseEnter={() => setActiveIndex(suggestions.length)}
                onClick={() => void commitCreate()}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-secondary text-fg',
                  activeIndex === suggestions.length && 'bg-surface-muted',
                )}
              >
                <Icon name="plus" size={12} className="text-fg-muted" />
                <span className="min-w-0 flex-1 truncate">
                  {t('task.addTag')} · {query.trim()}
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
