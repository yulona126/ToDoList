import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export function Spinner({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Full-viewport loader used while the stored session is being exchanged. */
export function PageLoader({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('common.loading');
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg text-fg-muted"
      role="status"
      aria-live="polite"
    >
      <Spinner size={20} />
      <p className="text-secondary">{text}</p>
    </div>
  );
}
