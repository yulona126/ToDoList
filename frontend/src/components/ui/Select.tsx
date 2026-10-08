import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Icon } from './Icon';
import { CONTROL_CLASSES } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  label?: string;
  error?: string;
  hint?: string;
  options?: readonly SelectOption[];
  children?: ReactNode;
  containerClassName?: string;
}

/** Native select: keyboard + mobile behaviour for free, restyled monochrome. */
export function Select({
  label,
  error,
  hint,
  options,
  children,
  containerClassName,
  className,
  id,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex w-full flex-col gap-1', containerClassName)}>
      {label ? (
        <label
          htmlFor={selectId}
          className="text-secondary font-medium text-fg-muted"
        >
          {label}
        </label>
      ) : null}

      <div className="relative flex items-center">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            CONTROL_CLASSES,
            'h-8 cursor-pointer appearance-none py-0 pr-7 pl-2.5',
            error && 'border-2 border-fg',
            className,
          )}
          {...rest}
        >
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
        <Icon
          name="chevron-down"
          size={12}
          className="pointer-events-none absolute right-2 text-fg-subtle"
        />
      </div>

      {message ? (
        <p
          id={messageId}
          className={cn('text-meta', error ? 'text-fg' : 'text-fg-subtle')}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
