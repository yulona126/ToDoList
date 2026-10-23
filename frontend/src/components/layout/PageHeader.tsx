import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Accessible label for the back control. */
  backLabel: string;
  onBack: () => void;
  /** Status badges etc. shown beside the title. */
  titleMeta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Page title row with a back control optically aligned to the title.
 * Replaces the old stacked “tiny chevron + label / title” pattern.
 */
export function PageHeader({
  title,
  description,
  backLabel,
  onBack,
  titleMeta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <IconButton
          label={backLabel}
          size="md"
          onClick={onBack}
          className="mt-0.5"
        >
          <Icon name="arrow-left" size={18} strokeWidth={1.75} />
        </IconButton>

        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-page-title font-semibold leading-tight">
              {title}
            </h1>
            {titleMeta}
          </div>
          {description ? (
            <p className="mt-0.5 text-secondary text-fg-muted">{description}</p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
