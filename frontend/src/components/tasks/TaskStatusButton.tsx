import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TASK_STATUS_LABEL_KEY,
  TASK_STATUS_VALUES,
  TaskStatus,
} from '../../lib/constants';
import { cn } from '../../lib/utils';
import type { Task } from '../../types';
import { Icon } from '../ui/Icon';

export interface TaskStatusButtonProps {
  task: Task;
  onChange: (task: Task, status: TaskStatus) => void;
  disabled?: boolean;
}

/** The order a click walks through. `blocked` is a detour, not a step. */
const CYCLE: TaskStatus[] = [TaskStatus.Todo, TaskStatus.Doing, TaskStatus.Done];

function nextStatus(current: TaskStatus): TaskStatus {
  const index = CYCLE.indexOf(current);
  // From `blocked` (or anything unexpected), the useful default is "done".
  if (index === -1) return TaskStatus.Done;
  return CYCLE[(index + 1) % CYCLE.length]!;
}

/**
 * Status as a filled pill rather than a bare checkbox.
 *
 * Two problems with the old control: a circle only knew two states, so
 * "in progress" was invisible in the list; and moving a task to a specific
 * status meant opening the editor. This shows the current state as a coloured
 * block (inverting for `doing`, which is the state worth seeing at a glance)
 * and changes it in one click. The caret opens every status for a direct jump,
 * so `blocked` is reachable without cycling past it.
 */
export function TaskStatusButton({ task, onChange, disabled }: TaskStatusButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label = t(TASK_STATUS_LABEL_KEY[task.status]);
  const isDone = task.status === TaskStatus.Done;
  const isDoing = task.status === TaskStatus.Doing;
  const isBlocked = task.status === TaskStatus.Blocked;

  if (disabled) {
    return (
      <span
        className={cn(
          'inline-flex h-6 items-center rounded-pill px-2 text-meta',
          'border border-border text-fg-subtle',
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChange(task, nextStatus(task.status));
        }}
        title={t('task.advanceStatus', { status: t(TASK_STATUS_LABEL_KEY[nextStatus(task.status)]) })}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-pill px-2 text-meta',
          'transition-colors duration-150',
          // Inverted for "doing": the only state that should catch the eye.
          isDoing && 'bg-fg text-fg-inverse',
          isBlocked && 'border border-fg font-medium text-fg',
          isDone && 'bg-surface-muted text-fg-subtle line-through',
          !isDoing && !isBlocked && !isDone && 'border border-border text-fg-muted hover:border-border-strong',
        )}
      >
        {isBlocked ? <span aria-hidden="true">!</span> : null}
        {label}
      </button>

      <button
        type="button"
        aria-label={t('task.pickStatus')}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          'ml-0.5 inline-flex h-6 w-4 items-center justify-center rounded-pill',
          'text-fg-subtle hover:text-fg',
        )}
      >
        <Icon name="chevron-down" size={10} />
      </button>

      {open ? (
        <>
          {/* Click-away. Rendered before the menu so the menu paints above it. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            className={cn(
              'absolute left-0 top-7 z-50 min-w-[108px] overflow-hidden',
              'rounded-control border border-border bg-surface py-1',
              'shadow-popover',
            )}
          >
            {TASK_STATUS_VALUES.map((status) => (
              <li key={status}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    if (status !== task.status) onChange(task, status);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-meta',
                    status === task.status
                      ? 'font-medium text-fg'
                      : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                  )}
                >
                  {t(TASK_STATUS_LABEL_KEY[status])}
                  {status === task.status ? <Icon name="check" size={11} /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </span>
  );
}
