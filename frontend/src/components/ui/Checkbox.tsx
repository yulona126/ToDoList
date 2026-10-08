import type { ComponentPropsWithRef } from 'react';
import { cn } from '../../lib/utils';
import type { TaskStatus } from '../../lib/constants';

export interface CheckboxProps
  extends Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Mark … as done". */
  label: string;
  /** Drives the circle glyph (design-system §2). */
  status?: TaskStatus;
  disabled?: boolean;
}

/**
 * 20px round task checkbox.
 *
 * Colour-free state encoding (design-system §2):
 *   todo    ○ hollow
 *   doing   ◐ half filled
 *   done    ● filled + white check
 *   blocked is a row-level treatment (left rule + `!`), never a colour.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  status,
  disabled = false,
  className,
  ...rest
}: CheckboxProps) {
  const resolved: TaskStatus = status ?? (checked ? 'done' : 'todo');

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill',
        'motion-safe-150 text-fg',
        !disabled && 'hover:opacity-70',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        width={20}
        height={20}
        aria-hidden="true"
        focusable="false"
      >
        {resolved === 'done' ? (
          <circle cx="12" cy="12" r="9" fill="currentColor" />
        ) : (
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        )}

        {resolved === 'doing' ? (
          <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
        ) : null}

        {resolved === 'blocked' ? (
          <path
            d="M16 8 8 16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        ) : null}

        {resolved === 'done' ? (
          <path
            d="m7.8 12.4 3 3 5.4-6"
            fill="none"
            stroke="var(--fg-inverse)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </button>
  );
}
