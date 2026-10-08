import type { ComponentPropsWithRef } from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant = 'outline' | 'solid' | 'muted';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  outline: 'border border-border bg-transparent text-fg-muted',
  muted: 'border border-transparent bg-surface-muted text-fg-muted',
  solid: 'border border-transparent bg-accent text-fg-inverse',
};

/** Monochrome pill used for counters, tags and priority/type markers. */
export function Badge({
  variant = 'outline',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-pill px-1.5 py-0.5',
        'text-meta leading-none whitespace-nowrap',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
