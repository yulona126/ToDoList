import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DUE_FILTER_LABEL_KEY,
  DUE_FILTER_VALUES,
  DEFAULT_TASK_ORDERING,
  TASK_ORDERING_OPTIONS,
  TASK_PRIORITY_LABEL_KEY,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_LABEL_KEY,
  TASK_STATUS_VALUES,
  TASK_TYPE_LABEL_KEY,
  TASK_TYPE_VALUES,
  DueFilter,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '../../lib/constants';
import { focusIfVisible, registerSearchFocusHandler } from '../../lib/focusBus';
import {
  countActiveFilters,
  type TaskFilterState,
} from '../../lib/taskFilters';
import { cn } from '../../lib/utils';
import type { SelectOption } from '../ui/Select';
import type { Tag } from '../../types';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';

export interface TaskFiltersProps {
  filters: TaskFilterState;
  onChange: (patch: Partial<TaskFilterState>) => void;
  onReset: () => void;
  tags: readonly Tag[];
  resultCount: number;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  onNewList: () => void;
}

interface ActiveChip {
  key: keyof TaskFilterState;
  icon: IconName;
  label: string;
  value: string;
}

/**
 * Task board toolbar.
 *
 * Layout budget is deliberately tight (the previous revision stacked six
 * full-width selects into ~7 rows):
 *
 *   row 1 — status segments · 筛选 · 排序 · new list · bulk select · count
 *   row 2 — removable chips, rendered ONLY while a filter is active
 *
 * Everything that does not fit on a 375px viewport (status, ordering) is moved
 * into the 筛选 popover rather than wrapping onto extra rows.
 */
export function TaskFilters({
  filters,
  onChange,
  onReset,
  tags,
  resultCount,
  selectionMode,
  onToggleSelectionMode,
  onNewList,
}: TaskFiltersProps) {
  const { t } = useTranslation();
  const activeCount = countActiveFilters(filters);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /* Compact search for < 640px, where the Topbar input is hidden. `/` focuses
     whichever of the two is actually visible (lib/focusBus.ts). */
  useEffect(
    () => registerSearchFocusHandler(() => focusIfVisible(searchRef.current)),
    [],
  );

  const allOption: SelectOption = { value: '', label: t('common.all') };

  const statusOptions: SelectOption[] = [
    allOption,
    ...TASK_STATUS_VALUES.map((value) => ({
      value,
      label: t(TASK_STATUS_LABEL_KEY[value]),
    })),
  ];
  const priorityOptions: SelectOption[] = [
    allOption,
    ...TASK_PRIORITY_VALUES.map((value) => ({
      value,
      label: t(TASK_PRIORITY_LABEL_KEY[value]),
    })),
  ];
  const typeOptions: SelectOption[] = [
    allOption,
    ...TASK_TYPE_VALUES.map((value) => ({
      value,
      label: t(TASK_TYPE_LABEL_KEY[value]),
    })),
  ];
  const dueOptions: SelectOption[] = DUE_FILTER_VALUES.map((value) => ({
    value,
    label: t(DUE_FILTER_LABEL_KEY[value]),
  }));
  const tagOptions: SelectOption[] = [
    allOption,
    ...tags.map((tag) => ({ value: String(tag.id), label: tag.name })),
  ];
  const orderingOptions: SelectOption[] = TASK_ORDERING_OPTIONS.map(
    (option) => ({ value: option.value, label: t(option.labelKey) }),
  );

  const orderingLabel =
    orderingOptions.find((option) => option.value === filters.ordering)?.label ??
    t('task.filterOrdering');

  /* Removable summary of everything currently narrowing the list. */
  const chips: ActiveChip[] = [];
  if (filters.status) {
    chips.push({
      key: 'status',
      icon: 'check',
      label: t('task.filterStatus'),
      value: t(TASK_STATUS_LABEL_KEY[filters.status]),
    });
  }
  if (filters.priority) {
    chips.push({
      key: 'priority',
      icon: 'alert',
      label: t('task.filterPriority'),
      value: t(TASK_PRIORITY_LABEL_KEY[filters.priority]),
    });
  }
  if (filters.taskType) {
    chips.push({
      key: 'taskType',
      icon: 'dot',
      label: t('task.filterType'),
      value: t(TASK_TYPE_LABEL_KEY[filters.taskType]),
    });
  }
  if (filters.tagId !== null) {
    const tag = tags.find((item) => item.id === filters.tagId);
    chips.push({
      key: 'tagId',
      icon: 'tag',
      label: t('task.filterTag'),
      value: tag?.name ?? String(filters.tagId),
    });
  }
  if (filters.due !== DueFilter.All) {
    chips.push({
      key: 'due',
      icon: 'calendar',
      label: t('task.filterDue'),
      value: t(DUE_FILTER_LABEL_KEY[filters.due]),
    });
  }
  if (filters.ordering !== DEFAULT_TASK_ORDERING) {
    chips.push({
      key: 'ordering',
      icon: 'refresh',
      label: t('task.filterOrdering'),
      value: orderingLabel,
    });
  }

  const clearChip = (key: keyof TaskFilterState): void => {
    if (key === 'due') onChange({ due: DueFilter.All });
    else if (key === 'ordering') onChange({ ordering: DEFAULT_TASK_ORDERING });
    else if (key === 'tagId') onChange({ tagId: null });
    else if (key === 'status') onChange({ status: null });
    else if (key === 'priority') onChange({ priority: null });
    else if (key === 'taskType') onChange({ taskType: null });
  };

  const statusSegment = (value: TaskStatus | null, label: string) => {
    const active = filters.status === value;
    return (
      <button
        key={value ?? 'all'}
        type="button"
        aria-pressed={active}
        onClick={() => onChange({ status: value })}
        className={cn(
          'h-8 px-2.5 text-secondary motion-safe-150 first:rounded-l-control last:rounded-r-control',
          'border-y border-r border-border first:border-l',
          active
            ? 'bg-accent font-medium text-fg-inverse'
            : 'bg-bg text-fg-muted hover:bg-surface-muted hover:text-fg',
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="border-b border-border pb-2.5">
      {/* ---------------------------------------------------------- row 1 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="w-full min-w-0 sm:hidden">
          <Input
            ref={searchRef}
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder={t('task.searchPlaceholder')}
            aria-label={t('common.search')}
            leadingIcon={<Icon name="search" size={14} />}
          />
        </div>

        {/* Status is the most-used facet, so it stays inline on ≥ 640px. */}
        <div
          role="group"
          aria-label={t('task.filterStatus')}
          className="hidden items-center sm:flex"
        >
          {statusSegment(null, t('common.all'))}
          {TASK_STATUS_VALUES.map((value) =>
            statusSegment(value, t(TASK_STATUS_LABEL_KEY[value])),
          )}
        </div>

        <Popover
          triggerLabel={t('task.filtersTitle')}
          trigger={
            <>
              <Icon name="filter" size={14} />
              <span>{t('task.filters')}</span>
              {activeCount > 0 ? (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-accent px-1 text-[11px] font-medium text-fg-inverse tabular-nums">
                  {activeCount}
                </span>
              ) : null}
            </>
          }
          panelClassName="max-h-[70vh] overflow-y-auto"
        >
          <div className="flex flex-col gap-2.5">
            {/* Status and sort only live here on narrow screens. */}
            <Select
              label={t('task.filterStatus')}
              containerClassName="sm:hidden"
              value={filters.status ?? ''}
              options={statusOptions}
              onChange={(event) =>
                onChange({
                  status: (event.target.value || null) as TaskStatus | null,
                })
              }
            />
            <Select
              label={t('task.filterPriority')}
              value={filters.priority ?? ''}
              options={priorityOptions}
              onChange={(event) =>
                onChange({
                  priority: (event.target.value || null) as TaskPriority | null,
                })
              }
            />
            <Select
              label={t('task.filterType')}
              value={filters.taskType ?? ''}
              options={typeOptions}
              onChange={(event) =>
                onChange({
                  taskType: (event.target.value || null) as TaskType | null,
                })
              }
            />
            <Select
              label={t('task.filterTag')}
              value={filters.tagId === null ? '' : String(filters.tagId)}
              options={tagOptions}
              onChange={(event) =>
                onChange({
                  tagId: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
            <Select
              label={t('task.filterDue')}
              value={filters.due}
              options={dueOptions}
              onChange={(event) =>
                onChange({ due: event.target.value as DueFilter })
              }
            />
            <Select
              label={t('task.filterOrdering')}
              containerClassName="sm:hidden"
              value={filters.ordering}
              options={orderingOptions}
              onChange={(event) => onChange({ ordering: event.target.value })}
            />
          </div>

          {activeCount > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="mt-3 w-full rounded-control border border-border px-2 py-1.5 text-meta text-fg-muted motion-safe-150 hover:border-border-strong hover:text-fg"
            >
              {t('task.clearAllFilters')}
            </button>
          ) : null}
        </Popover>

        <Select
          aria-label={t('task.filterOrdering')}
          containerClassName="hidden w-[124px] sm:block"
          value={filters.ordering}
          options={orderingOptions}
          onChange={(event) => onChange({ ordering: event.target.value })}
        />

        <div className="ml-auto flex items-center gap-1">
          <IconButton label={t('list.new')} onClick={onNewList}>
            <Icon name="folder" size={14} />
          </IconButton>

          <IconButton
            label={
              selectionMode
                ? t('task.selectionModeOff')
                : t('task.selectionModeOn')
            }
            variant={selectionMode ? 'secondary' : 'ghost'}
            aria-pressed={selectionMode}
            onClick={onToggleSelectionMode}
            className={selectionMode ? 'border-fg' : undefined}
          >
            <Icon name={selectionMode ? 'close' : 'check'} size={14} />
          </IconButton>
        </div>
      </div>

      {/* ------------------------------------- row 2 — only while filtering */}
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-6 max-w-[240px] items-center gap-1 rounded-pill border border-border bg-surface-muted pr-1 pl-2 text-meta text-fg"
            >
              <Icon
                name={chip.icon}
                size={11}
                className="shrink-0 text-fg-subtle"
              />
              <span className="truncate">
                <span className="text-fg-muted">{chip.label}</span>
                {' · '}
                {chip.value}
              </span>
              <button
                type="button"
                aria-label={t('task.removeFilter', {
                  name: `${chip.label} ${chip.value}`,
                })}
                title={t('task.removeFilter', { name: chip.label })}
                onClick={() => clearChip(chip.key)}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-pill text-fg-subtle motion-safe-150 hover:bg-border hover:text-fg"
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}

          {filters.search ? (
            <span className="inline-flex h-6 max-w-[240px] items-center gap-1 rounded-pill border border-border bg-surface-muted pr-1 pl-2 text-meta text-fg">
              <Icon name="search" size={11} className="shrink-0 text-fg-subtle" />
              <span className="truncate">
                <span className="text-fg-muted">{t('common.search')}</span>
                {' · '}
                {filters.search}
              </span>
              <button
                type="button"
                aria-label={t('task.removeFilter', { name: t('common.search') })}
                onClick={() => onChange({ search: '' })}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-pill text-fg-subtle motion-safe-150 hover:bg-border hover:text-fg"
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ) : null}

          <button
            type="button"
            onClick={onReset}
            className="ml-1 text-meta text-fg-muted underline-offset-2 motion-safe-150 hover:text-fg hover:underline"
          >
            {t('task.clearAllFilters')}
          </button>

          {/* The result count only appears while filtering: the header already
              totals the workspace, and the two numbers count different things
              (top-level rows here vs. every task including sub-tasks there). */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-meta text-fg-subtle tabular-nums">
              {t('common.countTotal', { total: resultCount })}
            </span>
            <span className="hidden text-meta text-fg-subtle md:inline">
              {t('task.keyboardHint')}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
