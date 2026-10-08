import { useId, type ComponentPropsWithRef } from 'react';
import { cn } from '../../lib/utils';
import { CONTROL_CLASSES } from './Input';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

export function Textarea({
  label,
  error,
  hint,
  containerClassName,
  className,
  id,
  rows = 3,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const messageId = `${textareaId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex w-full flex-col gap-1', containerClassName)}>
      {label ? (
        <label
          htmlFor={textareaId}
          className="text-secondary font-medium text-fg-muted"
        >
          {label}
        </label>
      ) : null}

      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          CONTROL_CLASSES,
          'min-h-[72px] resize-y px-2.5 py-1.5',
          error && 'border-2 border-fg',
          className,
        )}
        {...rest}
      />

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
