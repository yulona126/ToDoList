import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DUE_FILTER_LABEL_KEY,
  DUE_FILTER_VALUES,
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
import type { SelectOption } from '../ui/Select';
import type { Tag } from '../../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
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

/**
 * Filter bar for the task board: status / priority / type / tag / due + ordering.
 * The values accept comma-separated multi-select on the wire (api.md §4); the UI
 * deliberately exposes one value per facet to stay readable at 375px.
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

  return (
    <div className="flex flex-col gap-2 border-b border-border pb-3">
      <div className="sm:hidden">
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

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('task.filterStatus')}
          containerClassName="w-[110px]"
          value={filters.status ?? ''}
          options={statusOptions}
          onChange={(event) =>
            onChange({
              status: (event.target.value || null) as TaskStatus | null,
            })
          }
        />
        <Select
          aria-label={t('task.filterPriority')}
          containerClassName="w-[110px]"
          value={filters.priority ?? ''}
          options={priorityOptions}
          onChange={(event) =>
            onChange({
              priority: (event.target.value || null) as TaskPriority | null,
            })
          }
        />
        <Select
          aria-label={t('task.filterType')}
          containerClassName="w-[110px]"
          value={filters.taskType ?? ''}
          options={typeOptions}
          onChange={(event) =>
            onChange({
              taskType: (event.target.value || null) as TaskType | null,
            })
          }
        />
        <Select
          aria-label={t('task.filterTag')}
          containerClassName="w-[130px]"
          value={filters.tagId === null ? '' : String(filters.tagId)}
          options={tagOptions}
          onChange={(event) =>
            onChange({
              tagId: event.target.value ? Number(event.target.value) : null,
            })
          }
        />
        <Select
          aria-label={t('task.filterDue')}
          containerClassName="w-[110px]"
          value={filters.due}
          options={dueOptions}
          onChange={(event) =>
            onChange({ due: event.target.value as DueFilter })
          }
        />
        <Select
          aria-label={t('task.filterOrdering')}
          containerClassName="w-[130px]"
          value={filters.ordering}
          options={orderingOptions}
          onChange={(event) => onChange({ ordering: event.target.value })}
        />

        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            iconLeft={<Icon name="close" size={12} />}
          >
            {t('task.resetFilters')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewList}
          iconLeft={<Icon name="folder" size={13} />}
        >
          {t('list.new')}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSelectionMode}
          aria-pressed={selectionMode}
          iconLeft={<Icon name={selectionMode ? 'close' : 'check'} size={13} />}
        >
          {selectionMode ? t('task.selectionModeOff') : t('task.selectionModeOn')}
        </Button>

        <span className="ml-auto hidden text-meta text-fg-subtle md:inline">
          {t('task.keyboardHint')}
        </span>

        <span className="text-meta text-fg-subtle md:ml-3">
          {t('common.countTotal', { total: resultCount })}
        </span>
      </div>
    </div>
  );
}
