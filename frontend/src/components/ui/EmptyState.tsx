import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** design-system §3: 32px linear icon + one line + (optional) one primary action. */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 py-12 text-center',
        className,
      )}
    >
      <Icon name={icon} size={32} className="text-fg-subtle" strokeWidth={1.25} />
      <div className="flex flex-col gap-1">
        <p className="text-card-title font-semibold text-fg">{title}</p>
        {description ? (
          <p className="text-secondary text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
