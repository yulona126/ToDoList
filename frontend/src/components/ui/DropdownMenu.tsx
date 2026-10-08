import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from './Icon';

export interface DropdownMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** Renders a divider above this item. */
  separatorBefore?: boolean;
}

export interface DropdownMenuProps {
  /** Content of the trigger button. */
  trigger: ReactNode;
  /** Accessible name for the trigger (required — it is usually icon-only). */
  triggerLabel: string;
  items: readonly DropdownMenuItem[];
  align?: 'start' | 'end';
  triggerClassName?: string;
  menuClassName?: string;
}

/**
 * Monochrome popover menu with roving focus.
 *
 * Keyboard: Enter/Space/ArrowDown opens, ArrowUp/ArrowDown move, Home/End jump,
 * Enter/Space activate, Esc closes and returns focus to the trigger.
 */
export function DropdownMenu({
  trigger,
  triggerLabel,
  items,
  align = 'end',
  triggerClassName,
  menuClassName,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  const close = (restoreFocus = true): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const focusIndex = (index: number): void => {
    itemRefs.current[index]?.focus();
  };

  const focusEdge = (edge: 'first' | 'last'): void => {
    if (enabledIndexes.length === 0) return;
    focusIndex(
      edge === 'first'
        ? enabledIndexes[0]
        : enabledIndexes[enabledIndexes.length - 1],
    );
  };

  /* Move focus into the menu as soon as it opens. */
  useEffect(() => {
    if (open) focusEdge('first');
  }, [open]);

  /* Close on outside pointerdown. */
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
  };

  const handleItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const position = enabledIndexes.indexOf(index);
        if (position < 0) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next =
          enabledIndexes[
            (position + delta + enabledIndexes.length) % enabledIndexes.length
          ];
        focusIndex(next);
        break;
      }
      case 'Home':
        event.preventDefault();
        focusEdge('first');
        break;
      case 'End':
        event.preventDefault();
        focusEdge('last');
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'inline-flex items-center gap-1 rounded-control text-fg-muted motion-safe-150',
          'hover:bg-surface-muted hover:text-fg',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={triggerLabel}
          className={cn(
            'absolute top-[calc(100%+4px)] z-50 min-w-[180px] rounded-card border border-border',
            'bg-surface p-1 shadow-popover',
            align === 'end' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore ? (
                <div className="my-1 h-px bg-border" role="separator" />
              ) : null}
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled ?? false}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                onKeyDown={(event) => handleItemKeyDown(event, index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left',
                  'text-secondary text-fg motion-safe-150',
                  'hover:bg-surface-muted focus:bg-surface-muted focus:outline-none',
                  item.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {item.icon ? (
                  <Icon name={item.icon} size={14} className="text-fg-muted" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
