import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TASK_PRIORITY_LABEL_KEY,
  TASK_TYPE_ICON,
  TASK_TYPE_LABEL_KEY,
  type TaskPriority,
} from '../../lib/constants';
import { cn, formatShortDate } from '../../lib/utils';
import type { Task } from '../../types';
import { Badge } from '../ui/Badge';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { SubTaskList } from './SubTaskList';

export interface TaskItemProps {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Bulk-selection mode: renders a leading square checkbox. */
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (task: Task) => void;
  /** Show the list name next to the title (used in search results). */
  showListName?: boolean;
}

/**
 * The 44px task row — design-system §4.
 *
 * `[○] title … [▲] [</>] [tag] 02-20 [⋯]` with colour-free status encoding:
 * blocked = `!` prefix + 3px left rule, done = strikethrough + 55% opacity,
 * overdue = ⌛ + 600 weight, priority = filled/hollow shape (urgent adds URGENT).
 */
export function TaskItem({
  task,
  onToggle,
  onEdit,
  onDelete,
  selectable = false,
  selected = false,
  onSelectToggle,
  showListName = false,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const done = task.status === 'done';
  const blocked = task.status === 'blocked';
  const hasSubtasks = task.subtask_stats.total > 0;
  const visibleTags = task.tags.slice(0, 3);
  const extraTags = task.tags.length - visibleTags.length;

  return (
    <li className="list-none">
      <div
        className={cn(
          'group flex min-h-[44px] items-center gap-2 rounded-control px-2 py-1',
          'hover:bg-surface-muted motion-safe-150',
          blocked && 'border-l-[3px] border-fg',
          done && 'opacity-55',
        )}
      >
        {selectable ? (
          <SelectionCheckbox
            checked={selected}
            label={task.title}
            onToggle={() => onSelectToggle?.(task)}
          />
        ) : null}

        <Checkbox
          checked={done}
          status={task.status}
          label={done ? t('common.markTodo') : t('common.markDone')}
          onChange={() => onToggle(task)}
        />

        {hasSubtasks ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={
              expanded ? t('task.collapseGroup') : t('task.openSubtasks')
            }
            className="-ml-1 rounded-control p-0.5 text-fg-subtle hover:text-fg"
          >
            <Icon
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={12}
            />
          </button>
        ) : (
          <span className="-ml-1 w-3" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={t('task.openEditor')}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span
            className={cn(
              'min-w-0 text-body text-fg',
              done && 'line-through',
            )}
          >
            {blocked ? <span className="mr-1 font-semibold">!</span> : null}
            <span className="break-words">{task.title}</span>
          </span>
          {showListName && task.task_list_name ? (
            <span className="shrink-0 text-meta text-fg-subtle">
              {task.task_list_name}
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {hasSubtasks ? (
            <span className="text-meta text-fg-muted tabular-nums">
              {t('task.subtaskProgress', {
                done: task.subtask_stats.done,
                total: task.subtask_stats.total,
              })}
            </span>
          ) : null}

          {visibleTags.length > 0 ? (
            <span className="hidden items-center gap-1 sm:flex">
              {visibleTags.map((tag) => (
                <Badge key={tag.id} variant="muted">
                  <Icon name="tag" size={10} />
                  {tag.name}
                </Badge>
              ))}
              {extraTags > 0 ? (
                <span className="text-meta text-fg-subtle">+{extraTags}</span>
              ) : null}
            </span>
          ) : null}

          <span className="hidden text-fg-muted sm:flex">
            <Tooltip label={t(TASK_TYPE_LABEL_KEY[task.task_type])}>
              <Icon name={TASK_TYPE_ICON[task.task_type]} size={14} />
            </Tooltip>
          </span>

          <PriorityMarker priority={task.priority} />

          {task.due_date ? (
            <Tooltip
              label={t(task.is_overdue ? 'task.overdue' : 'task.dueDate')}
            >
              <span
                className={cn(
                  'whitespace-nowrap text-meta tabular-nums',
                  task.is_overdue
                    ? 'font-semibold text-fg'
                    : 'text-fg-muted',
                )}
              >
                {task.is_overdue ? '⌛ ' : ''}
                {formatShortDate(task.due_date)}
              </span>
            </Tooltip>
          ) : null}

          <span className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <IconButton
              label={t('common.edit')}
              size="sm"
              onClick={() => onEdit(task)}
            >
              <Icon name="edit" size={13} />
            </IconButton>
            <IconButton
              label={t('common.delete')}
              size="sm"
              onClick={() => onDelete(task)}
            >
              <Icon name="trash" size={13} />
            </IconButton>
          </span>
        </div>
      </div>

      {expanded ? <SubTaskList task={task} /> : null}
    </li>
  );
}

/** Square checkbox used only in bulk-selection mode. */
function SelectionCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-fg"
    >
      <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="4"
          fill={checked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
        />
        {checked ? (
          <path
            d="m8 12 3 3 5.5-6"
            fill="none"
            stroke="var(--fg-inverse)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </button>
  );
}

/**
 * Priority without colour (design-system §2):
 *   urgent ■ + `URGENT` · high ▲ filled · medium △ outline · low silent.
 */
function PriorityMarker({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation();
  const label = t(TASK_PRIORITY_LABEL_KEY[priority]);

  if (priority === 'low') return null;

  if (priority === 'urgent') {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-flex items-center gap-1 text-fg"
      >
        <span className="h-2 w-2 bg-fg" aria-hidden="true" />
        <span className="text-[10px] font-semibold tracking-wider uppercase">
          {t('constants.priority.urgent')}
        </span>
      </span>
    );
  }

  const filled = priority === 'high';
  return (
    <span role="img" aria-label={label} title={label} className="text-fg-muted">
      <svg viewBox="0 0 10 10" width={9} height={9} aria-hidden="true">
        <path
          d={filled ? 'M5 0.5 10 9.5H0Z' : 'M5 1.4 9.1 8.8H0.9Z'}
          fill={filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={filled ? 0 : 1.1}
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
