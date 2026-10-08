import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Spinner } from './Spinner';

export type IconButtonVariant = 'ghost' | 'secondary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
  /** Required: design-system §6 — every icon-only control needs a name. */
  label: string;
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
}

/** Square icon button: 28 / 32 / 36 px, matching Button's size ladder. */
const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
};

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:
    'border border-transparent bg-transparent text-fg-muted hover:bg-surface-muted hover:text-fg',
  secondary:
    'border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-muted',
};

const SPINNER_SIZE: Record<IconButtonSize, number> = { sm: 12, md: 13, lg: 14 };

export function IconButton({
  label,
  children,
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled ?? false}
      aria-busy={loading ? true : undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center rounded-control',
        'motion-safe-150',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      <span className={cn('inline-flex', loading && 'invisible')}>
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={SPINNER_SIZE[size]} />
        </span>
      ) : null}
    </button>
  );
}
