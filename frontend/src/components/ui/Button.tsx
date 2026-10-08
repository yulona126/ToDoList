import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Inline spinner; the label keeps its space so the button never jumps. */
  loading?: boolean;
  block?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

/** design-system §3: sm 28px / md 32px / lg 36px. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2 text-meta',
  md: 'h-8 gap-1.5 px-3 text-secondary',
  lg: 'h-9 gap-2 px-3.5 text-body',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-accent text-fg-inverse hover:opacity-90 active:opacity-95',
  secondary:
    'border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-muted',
  ghost:
    'border border-transparent bg-transparent text-fg hover:bg-surface-muted',
  danger:
    'border border-border bg-surface text-fg hover:border-fg hover:bg-surface-muted',
};

const SPINNER_SIZE: Record<ButtonSize, number> = { sm: 12, md: 13, lg: 14 };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  iconLeft,
  iconRight,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? false}
      aria-busy={loading ? true : undefined}
      className={cn(
        'relative inline-flex select-none items-center justify-center rounded-control font-medium',
        'motion-safe-150 whitespace-nowrap',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        block && 'w-full',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center',
          size === 'sm' ? 'gap-1.5' : 'gap-2',
          loading && 'invisible',
        )}
      >
        {iconLeft}
        {children}
        {iconRight}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={SPINNER_SIZE[size]} />
        </span>
      ) : null}
    </button>
  );
}
