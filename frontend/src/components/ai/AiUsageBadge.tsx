import { useTranslation } from 'react-i18next';
import type { AiUsage } from '../../types';
import { cn } from '../../lib/utils';

export interface AiUsageBadgeProps {
  /** `null` for a local-parse result (nothing was billed). */
  usage: AiUsage | null;
  latencyMs?: number | null;
  className?: string;
}

/**
 * "What did this call cost" line — design-system §2 keeps it monochrome and
 * quiet, so it is plain meta text rather than a badge with a colour.
 *
 * `420 tok（缓存命中 215）· 1.8s` — the cached figure is called out separately
 * because context caching (T2) is the single biggest lever in the cost model.
 */
export function AiUsageBadge({ usage, latencyMs, className }: AiUsageBadgeProps) {
  const { t } = useTranslation();

  const total = usage?.total_tokens ?? 0;
  const cached = usage?.cached_tokens ?? 0;
  const hasUsage = usage != null;
  const hasLatency = typeof latencyMs === 'number' && latencyMs > 0;
  if (!hasUsage && !hasLatency) return null;

  const parts: string[] = [];
  if (hasUsage) {
    parts.push(
      cached > 0
        ? t('ai.usageTokensCached', { total, cached })
        : t('ai.usageTokens', { total }),
    );
  }
  if (hasLatency) {
    parts.push(t('ai.usageLatency', { seconds: (latencyMs / 1000).toFixed(1) }));
  }

  return (
    <span
      className={cn('text-meta text-fg-subtle tabular-nums', className)}
      data-testid="ai-usage"
    >
      {parts.join(' · ')}
    </span>
  );
}
