import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';

export interface AuthCardProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centred auth card with the brand mark (design-system §4). */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-fg-inverse">
            <Icon name="check" size={16} strokeWidth={2.5} />
          </span>
          <span className="text-page-title font-semibold">
            {t('common.appName')}
          </span>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h1 className="text-card-title font-semibold text-fg">{title}</h1>
          <p className="mt-0.5 mb-4 text-secondary text-fg-muted">{subtitle}</p>
          {children}
        </div>

        {footer ? (
          <div className="mt-4 text-center text-secondary text-fg-muted">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
