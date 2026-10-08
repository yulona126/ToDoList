import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';

/** Inline, monochrome error banner (never red — design-system §2). */
export function AlertBanner({ message }: { message: string }) {
  const { t } = useTranslation();

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-control border border-fg bg-surface-muted px-2.5 py-2 text-secondary text-fg"
    >
      <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <span className="sr-only">{t('common.error')}</span>
    </p>
  );
}
