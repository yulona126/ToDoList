import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { popModal, pushModal } from '../../lib/modalStack';
import { cn } from '../../lib/utils';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** `sm` = 480px (forms), `lg` = 640px (details). */
  size?: ModalSize;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-[480px]',
  lg: 'max-w-[640px]',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Centred dialog per design-system §3: Esc to close, overlay click to close,
 * body scroll lock, focus trap, `role="dialog" aria-modal="true"`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'sm',
  footer,
  children,
  className,
}: ModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  /* Keep the latest onClose without re-running the open/close effect, which would
     otherwise steal focus back to the first field on every parent render. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    pushModal();

    const panel = panelRef.current;
    const focusableNodes = (): HTMLElement[] =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
          ).filter((node) => node.tabIndex !== -1)
        : [];

    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (preferred ?? focusableNodes()[0] ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = focusableNodes();
      if (nodes.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = panel?.contains(active ?? null) ?? false;

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      popModal();
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-modal-open="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'my-auto flex w-full flex-col rounded-card border border-border bg-surface',
          'shadow-modal outline-none',
          'max-h-[calc(100dvh-2rem)]',
          SIZE_CLASSES[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id={titleId}
              className="text-card-title font-semibold text-fg"
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-secondary text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            label={t('common.close')}
            size="sm"
            onClick={onClose}
            className="-mt-0.5 -mr-1"
          >
            <Icon name="close" size={14} />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
