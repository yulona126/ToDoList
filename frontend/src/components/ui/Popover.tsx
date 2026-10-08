import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

export interface PopoverProps {
  /** Content rendered inside the trigger button. */
  trigger: ReactNode;
  /** Accessible name for the trigger (it is usually icon-only). */
  triggerLabel: string;
  /** Panel content — arbitrary markup, unlike `DropdownMenu`. */
  children: ReactNode;
  align?: 'start' | 'end';
  triggerClassName?: string;
  panelClassName?: string;
  /** Called after the panel closes, for one-shot cleanup. */
  onClose?: () => void;
}

/**
 * Monochrome popover for hosting arbitrary panel content (filters, pickers).
 *
 * Unlike `DropdownMenu` this makes no assumptions about the panel's children,
 * so it can hold form controls. Clicking anywhere inside the panel — including
 * on a `<select>` — must not close it, so only outside `pointerdown` closes.
 *
 * Keyboard: Enter/Space/ArrowDown opens, `Esc` closes and restores focus.
 */
export function Popover({
  trigger,
  triggerLabel,
  children,
  align = 'start',
  triggerClassName,
  panelClassName,
  onClose,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = (restoreFocus = true): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
    onClose?.();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-control border border-border bg-bg px-2.5',
          'text-secondary text-fg motion-safe-150 hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg',
          open && 'border-fg',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={triggerLabel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 w-[268px] rounded-card border border-border',
            'bg-surface p-3 shadow-popover',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
