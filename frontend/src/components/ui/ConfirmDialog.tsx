import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Spell out the consequence — design-system §7. */
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  /** `danger` keeps the monochrome look but uses the primary button weight. */
  confirmVariant?: 'primary' | 'danger';
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
  confirmVariant = 'primary',
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            loading={loading}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? (
        <div className="text-body text-fg-muted">{description}</div>
      ) : null}
    </Modal>
  );
}
