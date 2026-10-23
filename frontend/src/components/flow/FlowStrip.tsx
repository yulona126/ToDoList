import { useTranslation } from 'react-i18next';
import type { FlowSummary } from '../../types';
import { cn } from '../../lib/utils';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

export interface FlowStripProps {
  flow: FlowSummary | undefined;
  isLoading?: boolean;
}

/**
 * The whole "review" step, in two lines.
 *
 * This exists because backlog grooming is the thing that actually gets skipped.
 * Everything here is derived server-side, so reading it costs nothing — and the
 * server's `message` already says what to do about it, which is why the numbers
 * stay secondary (small, muted) and the sentence leads.
 */
export function FlowStrip({ flow, isLoading }: FlowStripProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-meta text-fg-subtle" role="status">
        <Spinner size={12} />
        {t('common.loading')}
      </div>
    );
  }
  if (!flow) return null;

  const attention =
    flow.wip_exceeded || flow.now === 0 || flow.stale_backlog > 0;

  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface-muted px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
        <span className="inline-flex items-center gap-1 font-medium text-fg">
          {t('flow.now')}
          <span className={cn('tabular-nums', flow.wip_exceeded && 'text-fg font-semibold')}>
            {flow.now}/{flow.wip_limit}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          {t('flow.backlog')}
          <span className="tabular-nums">{flow.backlog}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          {t('flow.doneThisWeek')}
          <span className="tabular-nums">{flow.done_this_week}</span>
        </span>
        {flow.stale_backlog > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-fg">
            <Icon name="alert" size={11} />
            {t('flow.stale', {
              total: flow.stale_backlog,
              days: flow.backlog_aging_days,
            })}
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          'flex items-start gap-1.5 text-meta',
          attention ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {attention ? (
          <Icon name="alert" size={11} className="mt-0.5 shrink-0 text-fg-subtle" />
        ) : null}
        <span>{flow.message}</span>
      </p>
    </div>
  );
}
