import { useEffect } from 'react';
import { hasOpenModal } from '../lib/modalStack';

export interface KeyboardShortcutOptions {
  /** `N` — open the "new task" dialog. */
  onCreateTask?: () => void;
  /** `/` — focus the search input. */
  onFocusSearch?: () => void;
  /** `Esc` — clear search / leave the current mode. */
  onEscape?: () => void;
  enabled?: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Shortcuts never fire while typing (design-system §5). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has(target.tagName);
}

/**
 * Global keyboard shortcuts (design-system §5).
 *
 * Suppressed when focus sits in a form control, and when a Modal owns focus —
 * `Esc` and `Cmd/Ctrl+Enter` are then the dialog's business.
 */
export function useKeyboardShortcuts({
  onCreateTask,
  onFocusSearch,
  onEscape,
  enabled = true,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (hasOpenModal()) return;

      const inEditable = isEditableTarget(event.target);

      if (event.key === 'Escape') {
        if (inEditable && event.target instanceof HTMLElement) {
          event.target.blur();
        }
        onEscape?.();
        return;
      }

      if (inEditable) return;

      if (event.key === 'n' || event.key === 'N') {
        if (!onCreateTask) return;
        event.preventDefault();
        onCreateTask();
        return;
      }

      if (event.key === '/') {
        if (!onFocusSearch) return;
        event.preventDefault();
        onFocusSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onCreateTask, onFocusSearch, onEscape]);
}
