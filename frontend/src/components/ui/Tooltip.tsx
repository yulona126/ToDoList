import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  label: string;
  side?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight, purely presentational tooltip. It complements — never replaces —
 * the `aria-label` that every icon-only control already carries.
 */
export function Tooltip({ label, side = 'top', children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const child = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': visible ? id : undefined,
      })
    : children;

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {child}
      <span
        id={id}
        role="tooltip"
        hidden={!visible}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
          'rounded-control bg-accent px-1.5 py-0.5 text-meta text-fg-inverse',
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {label}
      </span>
    </span>
  );
}
