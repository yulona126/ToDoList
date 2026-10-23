import { useTranslation } from 'react-i18next';
import type { Task, TaskEventKind } from '../../types';
import { useTaskEvents } from '../../hooks/useFlow';
import { cn, formatDateTime } from '../../lib/utils';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export interface TaskTimelinePanelProps {
  task: Task | null;
  onClose: () => void;
}

/** Icon + tone per event kind. Monochrome only — shape carries the meaning. */
const KIND_ICON: Record<TaskEventKind, 'plus' | 'arrow-right' | 'arrow-left' | 'check' | 'refresh' | 'alert' | 'dot' | 'history'> = {
  created: 'plus',
  committed: 'arrow-right',
  uncommitted: 'arrow-left',
  completed: 'check',
  reopened: 'refresh',
  blocked: 'alert',
  unblocked: 'dot',
  moved: 'arrow-right',
  noted: 'dot',
};

function formatHours(hours: number | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (hours === null) return '—';
  if (hours < 1) return t('flow.minutes', { total: Math.round(hours * 60) });
  if (hours < 48) return t('flow.hours', { total: Math.round(hours) });
  return t('flow.days', { total: Math.round(hours / 24) });
}

/**
 * "Fully understand one story" without reading a log.
 *
 * The timeline is written automatically by the server, so this panel is the
 * entire cost of that requirement — and it is paid only when you actually open
 * a task, never as part of capture or triage.
 */
export function TaskTimelinePanel({ task, onClose }: TaskTimelinePanelProps) {
  const { t } = useTranslation();
  const query = useTaskEvents(task?.id ?? 0, task !== null);

  return (
    <Modal
      open={task !== null}
      onClose={onClose}
      title={task ? t('flow.timelineTitle') : ''}
      description={task?.title}
      size="lg"
    >
      {query.isPending ? (
        <div className="flex items-center justify-center py-8 text-fg-subtle" role="status">
          <Spinner size={16} />
        </div>
      ) : query.isError || !query.data ? (
        <p className="py-6 text-center text-meta text-fg-muted">{t('flow.timelineError')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-card border border-border bg-surface-muted p-3 text-center">
            <div>
              <p className="text-meta text-fg-muted">{t('flow.leadTime')}</p>
              <p className="text-card-title font-medium tabular-nums text-fg">
                {formatHours(query.data.summary.lead_time_hours, t)}
              </p>
            </div>
            <div>
              <p className="text-meta text-fg-muted">{t('flow.activeTime')}</p>
              <p className="text-card-title font-medium tabular-nums text-fg">
                {formatHours(query.data.summary.active_hours, t)}
              </p>
            </div>
            <div>
              <p className="text-meta text-fg-muted">{t('flow.eventCount')}</p>
              <p className="text-card-title font-medium tabular-nums text-fg">
                {query.data.summary.event_count}
              </p>
            </div>
          </div>

          {query.data.summary.has_test_note ? (
            <p className="flex items-center gap-1.5 text-meta text-fg">
              <Icon name="check" size={12} />
              {t('flow.hasEvidence')}
            </p>
          ) : null}

          <ol className="flex flex-col">
            {query.data.results.map((event) => (
              <li key={event.id} className="flex gap-3 border-l border-border pb-3 pl-3 last:pb-0">
                <span className="-ml-[1.32rem] mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-fg-subtle">
                  <Icon name={KIND_ICON[event.kind]} size={9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('text-secondary text-fg', event.kind === 'noted' && 'text-fg-muted')}>
                      {t(`flow.event.${event.kind}`)}
                    </span>
                    <span className="text-meta tabular-nums text-fg-subtle">
                      {formatDateTime(event.created_at)}
                    </span>
                    {event.source !== 'ui' ? (
                      <span className="rounded-pill border border-border px-1.5 text-[11px] text-fg-subtle">
                        {event.source}
                      </span>
                    ) : null}
                  </div>
                  {event.note ? (
                    <p className="mt-0.5 break-words text-meta text-fg-muted">{event.note}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
