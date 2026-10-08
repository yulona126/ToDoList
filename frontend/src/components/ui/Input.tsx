import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label?: string;
  /** Error text below the control; also thickens the border (design-system §3). */
  error?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}

/** 32px control, 1px border, focus = `--fg` border + 2px `--border-strong` ring. */
export const CONTROL_CLASSES =
  'w-full rounded-control border border-border bg-bg text-body text-fg motion-safe-150 ' +
  'placeholder:text-fg-subtle ' +
  'focus:border-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-border-strong ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({
  label,
  error,
  hint,
  leadingIcon,
  trailing,
  containerClassName,
  className,
  id,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex w-full flex-col gap-1', containerClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className="text-secondary font-medium text-fg-muted"
        >
          {label}
        </label>
      ) : null}

      <div className="relative flex items-center">
        {leadingIcon ? (
          <span className="pointer-events-none absolute left-2 flex text-fg-subtle">
            {leadingIcon}
          </span>
        ) : null}

        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            CONTROL_CLASSES,
            'h-8 px-2.5',
            leadingIcon && 'pl-7',
            trailing && 'pr-8',
            error && 'border-2 border-fg',
            className,
          )}
          {...rest}
        />

        {trailing ? (
          <span className="absolute right-1 flex items-center">{trailing}</span>
        ) : null}
      </div>

      {message ? (
        <p
          id={messageId}
          className={cn(
            'text-meta',
            error ? 'text-fg' : 'text-fg-subtle',
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
