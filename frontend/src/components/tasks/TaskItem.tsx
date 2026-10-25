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
  /** Backlog ageing threshold, from the flow payload (default 14). */
  agingDays?: number;
  /** Pull into "Now" (docs/story-flow.md). */
  onCommit?: (task: Task) => void;
  /** Send back to the backlog. */
  onUncommit?: (task: Task) => void;
  /** Open the story timeline. */
  onShowTimeline?: (task: Task) => void;
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
  agingDays = 14,
  onCommit,
  onUncommit,
  onShowTimeline,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const done = task.status === 'done';
  const blocked = task.status === 'blocked';
  const hasSubtasks = task.subtask_stats.total > 0;

  /* Dwell time: how long this has been waiting where it is. It is the single
   * most useful number on the row — a 3-day-old "Now" item is normal, a
   * 21-day-old one is a decision you are avoiding. */
  const isDone = task.status === 'done';
  const dwellDays = task.is_committed ? (task.now_days ?? 0) : task.age_days;
  const dwellLimit = task.is_committed ? 7 : agingDays;
  const dwellWarn = !isDone && dwellDays >= dwellLimit;
  const showDwell = !isDone && dwellDays >= 1;

  /* Due dates are scanned, not read. Three tiers is the most a glance can carry:
     overdue (needs action now), within 2 days (needs attention), everything
     else (context only). The tiers are weight + colour-role, never hue. */
  const urgency: 'overdue' | 'soon' | 'later' | null = (() => {
    if (!task.due_date) return null;
    if (task.is_overdue) return 'overdue';
    const due = new Date(`${task.due_date}T23:59:59`).getTime();
    const days = Math.ceil((due - Date.now()) / 86_400_000);
    return days <= 2 ? 'soon' : 'later';
  })();
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

          {/* Type is the one fact that has no other cue in the row, so it gets a
              bordered micro-chip rather than a bare glyph: at 10px uppercase
              with tracking it stays readable while occupying ~40px. */}
          <Tooltip label={t(TASK_TYPE_LABEL_KEY[task.task_type])}>
            <span className="hidden items-center gap-1 rounded-control border border-border px-1.5 py-0.5 text-fg-muted sm:inline-flex">
              <Icon name={TASK_TYPE_ICON[task.task_type]} size={10} />
              <span className="eyebrow">{t(TASK_TYPE_LABEL_KEY[task.task_type])}</span>
            </span>
          </Tooltip>

          <PriorityMarker priority={task.priority} />

          {task.due_date ? (
            <Tooltip
              label={t(task.is_overdue ? 'task.overdue' : 'task.dueDate')}
            >
              <span
                className={cn(
                  'num whitespace-nowrap font-mono text-meta',
                  urgency === 'overdue' && 'font-semibold text-fg',
                  urgency === 'soon' && 'font-medium text-fg',
                  urgency === 'later' && 'text-fg-muted',
                  done && 'text-fg-subtle',
                )}
              >
                {urgency === 'overdue' ? '⌛ ' : ''}
                {formatShortDate(task.due_date)}
              </span>
            </Tooltip>
          ) : null}

          {showDwell ? (
            <Tooltip
              label={
                task.is_committed
                  ? t('flow.dwellNow', { days: dwellDays })
                  : t('flow.dwellBacklog', { days: dwellDays })
              }
            >
              <span
                className={cn(
                  'num whitespace-nowrap font-mono text-meta',
                  dwellWarn ? 'font-semibold text-fg' : 'text-fg-subtle',
                )}
              >
                {dwellWarn ? '⚠ ' : ''}
                {t('flow.dayShort', { days: dwellDays })}
              </span>
            </Tooltip>
          ) : null}

          <span className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {onShowTimeline ? (
              <IconButton
                label={t('flow.timelineTitle')}
                size="sm"
                onClick={() => onShowTimeline(task)}
              >
                <Icon name="history" size={13} />
              </IconButton>
            ) : null}
            {!isDone && !task.is_committed && onCommit ? (
              <IconButton
                label={t('flow.pullIn')}
                size="sm"
                onClick={() => onCommit(task)}
              >
                <Icon name="arrow-right" size={13} />
              </IconButton>
            ) : null}
            {!isDone && task.is_committed && onUncommit ? (
              <IconButton
                label={t('flow.sendBack')}
                size="sm"
                onClick={() => onUncommit(task)}
              >
                <Icon name="arrow-left" size={13} />
              </IconButton>
            ) : null}
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
        <span className="eyebrow font-semibold">{t('constants.priority.urgent')}</span>
      </span>
    );
  }

  const filled = priority === 'high';
  return (
    /* `high` reads at full contrast and `medium` stays muted, so the two are
       distinguishable without a second shape or a hue. */
    <span
      role="img"
      aria-label={label}
      title={label}
      className={filled ? 'text-fg' : 'text-fg-subtle'}
    >
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
