import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { FlowSummary, Task } from '../../types';
import { Badge } from '../ui/Badge';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

export interface NowPanelProps {
  flow: FlowSummary | undefined;
  tasks: Task[];
  /** yyyy-mm-dd -> plan a task for that day. */
  onPlan: (task: Task, day: string | null) => void;
  onUncommit: (task: Task) => void;
  onToggle: (task: Task) => void;
  onShowTimeline: (task: Task) => void;
  /** Clicking the body opens the editor. */
  onEdit: (task: Task) => void;
}

interface DayGroup {
  key: string;
  date: string | null;
  label: string;
  tasks: Task[];
  tone: 'today' | 'soon' | 'later' | 'carryover' | 'none';
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * "Now" grouped by day.
 *
 * The week is the commitment; the day is the plan. Two things follow from that:
 *
 * 1. Sections are ordered by date and only *today* gets full contrast, so the
 *    answer to "what am I doing right now" is the top block, always in the same
 *    place.
 * 2. Each row carries slightly more than the backlog row — a description line
 *    and the day it is planned for. In the backlog a title is enough; while you
 *    are working on something, "what is this actually" matters.
 */
export function NowPanel({
  flow,
  tasks,
  onPlan,
  onUncommit,
  onToggle,
  onShowTimeline,
  onEdit,
}: NowPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
  const today = flow?.today ?? new Date().toISOString().slice(0, 10);

  const groups = useMemo<DayGroup[]>(() => {
    const byDate = new Map<string, Task[]>();
    const carryover: Task[] = [];

    for (const task of tasks) {
      const day = task.planned_for;
      if (!day) {
        continue;
      }
      if (day < today) {
        carryover.push(task);
        continue;
      }
      byDate.set(day, [...(byDate.get(day) ?? []), task]);
    }

    const out: DayGroup[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(today, offset);
      const items = byDate.get(date);
      if (!items || items.length === 0) continue;
      /* Follow the app language, not the browser locale — otherwise a Chinese
         UI shows "Mon" because the OS happens to be English. */
      const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
        weekday: 'short',
      });
      out.push({
        key: date,
        date,
        label:
          offset === 0
            ? t('now.today', { weekday })
            : offset === 1
              ? t('now.tomorrow', { weekday })
              : t('now.day', { weekday, date: date.slice(5) }),
        tasks: items,
        tone: offset === 0 ? 'today' : offset <= 2 ? 'soon' : 'later',
      });
    }

    if (carryover.length > 0) {
      out.unshift({
        key: 'carryover',
        date: null,
        label: t('now.carryover', { count: carryover.length }),
        tasks: carryover,
        tone: 'carryover',
      });
    }
    return out;
  }, [tasks, today, t, locale]);

  const unscheduled = tasks.filter((task) => !task.planned_for);

  if (tasks.length === 0) {
    return (
      <section className="rounded-card border border-dashed border-border px-3 py-3">
        <p className="text-meta text-fg-muted">{t('now.empty')}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-card-title font-semibold text-fg">{t('now.title')}</h2>
        <span className="num text-meta text-fg-muted">
          {t('now.weekRange', {
            start: (flow?.week_start ?? '').slice(5),
            end: (flow?.week_end ?? '').slice(5),
          })}
        </span>
        <span className="num text-meta text-fg-muted">
          · {t('now.committed', { count: tasks.length })}
        </span>
        {(flow?.carryover ?? 0) > 0 ? (
          <span className="flex items-center gap-1 text-meta font-medium text-fg">
            <Icon name="alert" size={11} />
            {t('now.carryoverChip', { count: flow?.carryover ?? 0 })}
          </span>
        ) : null}
      </header>

      {groups.map((group) => (
        <div key={group.key}>
          <div
            className={cn(
              'mb-1 flex items-center gap-2 border-b border-border pb-1',
              group.tone === 'today' ? 'text-fg' : 'text-fg-muted',
            )}
          >
            <span
              className={cn(
                'text-meta',
                group.tone === 'today' ? 'font-semibold' : 'font-medium',
              )}
            >
              {group.label}
            </span>
            <span className="num text-meta text-fg-subtle">{group.tasks.length}</span>
          </div>

          <ul className="flex flex-col">
            {group.tasks.map((task) => (
              <NowRow
                key={task.id}
                task={task}
                today={today}
                onPlan={onPlan}
                onUncommit={onUncommit}
                onToggle={onToggle}
                onShowTimeline={onShowTimeline}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </div>
      ))}

      {unscheduled.length > 0 ? (
        <div>
          <div className="mb-1 border-b border-border pb-1 text-meta font-medium text-fg-muted">
            {t('now.unscheduled')} {unscheduled.length}
          </div>
          <ul className="flex flex-col">
            {unscheduled.map((task) => (
              <NowRow
                key={task.id}
                task={task}
                today={today}
                onPlan={onPlan}
                onUncommit={onUncommit}
                onToggle={onToggle}
                onShowTimeline={onShowTimeline}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function NowRow({
  task,
  today,
  onPlan,
  onUncommit,
  onToggle,
  onShowTimeline,
  onEdit,
}: {
  task: Task;
  today: string;
  onPlan: (task: Task, day: string | null) => void;
  onUncommit: (task: Task) => void;
  onToggle: (task: Task) => void;
  onShowTimeline: (task: Task) => void;
  onEdit: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const done = task.status === 'done';
  const late = !done && task.planned_for !== null && task.planned_for < today;
  const tomorrow = addDays(today, 1);

  return (
    <li className="group flex items-start gap-2.5 py-1.5">
      <span className="mt-1">
        <Checkbox
          checked={done}
          status={task.status}
          label={done ? t('common.markTodo') : t('common.markDone')}
          onChange={() => onToggle(task)}
        />
      </span>

      <button
        type="button"
        onClick={() => onEdit(task)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <span className={cn('text-body text-fg', done && 'line-through')}>
          {task.title}
        </span>
        {task.description ? (
          <span className="line-clamp-1 text-meta text-fg-muted">
            {task.description}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-subtle">
          <span className="eyebrow">{t(`constants.taskType.${task.task_type}`)}</span>
          {task.priority !== 'low' ? (
            <span className="text-fg-muted">
              {t(`constants.priority.${task.priority}`)}
            </span>
          ) : null}
          {task.assignee_detail ? (
            <span className="text-fg-muted">
              {task.assignee_detail.name || task.assignee_detail.email}
            </span>
          ) : null}
          {late ? (
            <span className="font-medium text-fg">
              {t('now.late', { days: task.now_days ?? 0 })}
            </span>
          ) : null}
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        {!done && task.planned_for !== tomorrow ? (
          <Tooltip label={t('now.moveTomorrow')}>
            <IconButton
              label={t('now.moveTomorrow')}
              size="sm"
              onClick={() => onPlan(task, tomorrow)}
            >
              <Icon name="arrow-right" size={12} />
            </IconButton>
          </Tooltip>
        ) : null}
        {!done && !task.planned_for ? (
          <Tooltip label={t('now.moveToday')}>
            <IconButton
              label={t('now.moveToday')}
              size="sm"
              onClick={() => onPlan(task, today)}
            >
              <Icon name="arrow-right" size={12} />
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip label={t('flow.timelineTitle')}>
          <IconButton
            label={t('flow.timelineTitle')}
            size="sm"
            onClick={() => onShowTimeline(task)}
          >
            <Icon name="history" size={12} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t('now.sendBack')}>
          <IconButton
            label={t('now.sendBack')}
            size="sm"
            onClick={() => onUncommit(task)}
          >
            <Icon name="arrow-left" size={12} />
          </IconButton>
        </Tooltip>
      </span>

      {late ? (
        <Badge variant="muted" className="mt-1 shrink-0">
          {t('now.lateBadge')}
        </Badge>
      ) : null}
    </li>
  );
}
