import { clsx, type ClassValue } from 'clsx';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { twMerge } from 'tailwind-merge';
import type { Task } from '../types';
import { PRIORITY_RANK, TaskPriority, type TaskStatus } from './constants';

dayjs.extend(relativeTime);
dayjs.extend(isSameOrBefore);
dayjs.extend(utc);

/**
 * Tailwind-friendly class combiner.
 *
 * `twMerge` is essential, not cosmetic: components put base utilities (e.g.
 * `w-full`) alongside caller overrides (e.g. `w-[110px]`) and plain `clsx`
 * emits both, leaving the winner to stylesheet order. Merging keeps the last
 * class the caller passed, which is what every `containerClassName` override
 * in this codebase assumes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ dates */

export const DATE_FORMAT = 'YYYY-MM-DD';

/** Compact due-date label used on a task row, e.g. `02-20`. */
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MM-DD') : '';
}

export function formatDate(
  value: string | null | undefined,
  pattern = DATE_FORMAT,
): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(pattern) : '';
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDate(value, 'YYYY-MM-DD HH:mm');
}

/** Localised "3 days ago" / "3 天前" — depends on the active dayjs locale. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.fromNow() : '';
}

export function todayIso(): string {
  return dayjs().format(DATE_FORMAT);
}

/** Client-side mirror of the server rule: `due_date < today AND status != done`. */
export function isOverdue(
  dueDate: string | null | undefined,
  status: TaskStatus,
): boolean {
  if (!dueDate || status === 'done') return false;
  return dayjs(dueDate).isBefore(dayjs().startOf('day'), 'day');
}

export function isDueToday(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return dayjs(dueDate).isSame(dayjs(), 'day');
}

export function isDueThisWeek(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const due = dayjs(dueDate).startOf('day');
  const today = dayjs().startOf('day');
  return due.isSameOrBefore(today.add(7, 'day'), 'day') && !due.isBefore(today, 'day');
}

/**
 * Client-side ordering, mirroring the server's `ordering` parameter
 * (api.md §4). Used for optimistic inserts before the server responds.
 */
export function compareTasks(
  a: Task,
  b: Task,
  ordering: string,
): number {
  const keys = ordering.split(',').filter(Boolean);
  for (const key of keys) {
    const desc = key.startsWith('-');
    const field = desc ? key.slice(1) : key;
    const direction = desc ? -1 : 1;
    let result = 0;
    switch (field) {
      case 'sort_order':
        result = a.sort_order - b.sort_order;
        break;
      case 'due_date': {
        const left = a.due_date ?? '9999-12-31';
        const right = b.due_date ?? '9999-12-31';
        result = left.localeCompare(right);
        break;
      }
      case 'priority':
        result = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      case 'created_at':
        result = a.created_at.localeCompare(b.created_at);
        break;
      case 'updated_at':
        result = a.updated_at.localeCompare(b.updated_at);
        break;
      default:
        result = 0;
    }
    if (result !== 0) return result * direction;
  }
  return a.id - b.id;
}

/* ---------------------------------------------------------------- helpers */

export function noop(): void {
  /* intentionally empty */
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getInitials(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

export function priorityRank(priority: TaskPriority): number {
  return PRIORITY_RANK[priority];
}

/**
 * Route helpers.
 *
 * `useParams()` inside a *layout* route only sees the layout's own params, so
 * the shell components derive ids from the pathname instead.
 */
export function workspaceIdFromPath(pathname: string): number | null {
  const match = /^\/w\/(\d+)(?:\/|$)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function listIdFromPath(pathname: string): number | null {
  const match = /^\/w\/\d+\/l\/(\d+)(?:\/|$)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Narrow an unknown thrown value to a printable message. */
export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
