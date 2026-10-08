import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkspace,
  useUpdateWorkspace,
} from '../../hooks/useWorkspaces';
import { fieldError, toApiError, type ApiError } from '../../lib/api';
import { useUI } from '../../stores/UIContext';
import type { Workspace } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Textarea';

export interface WorkspaceFormModalProps {
  open: boolean;
  /** Pass a workspace to edit; omit to create. */
  workspace?: Workspace | null;
  onClose: () => void;
}

/** Create + edit workspace. `Cmd/Ctrl+Enter` submits (design-system §5). */
export function WorkspaceFormModal({
  open,
  workspace = null,
  onClose,
}: WorkspaceFormModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { push } = useUI();
  const formId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<ApiError | null>(null);

  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? '');
    setDescription(workspace?.description ?? '');
    setNameError(undefined);
    setError(null);
  }, [open, workspace]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('validation.nameRequired'));
      return;
    }
    if (trimmed.length > 100) {
      setNameError(t('validation.nameTooLong'));
      return;
    }
    setNameError(undefined);

    try {
      if (workspace) {
        await updateMutation.mutateAsync({
          id: workspace.id,
          payload: { name: trimmed, description },
        });
        push({ type: 'success', message: t('workspace.updated') });
      } else {
        const created = await createMutation.mutateAsync({
          name: trimmed,
          description,
        });
        push({ type: 'success', message: t('workspace.created') });
        navigate(`/w/${created.id}`);
      }
      onClose();
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError);
      setNameError(fieldError(apiError, 'name'));
      push({ type: 'error', message: apiError.detail });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={workspace ? t('workspace.editTitle') : t('workspace.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
          >
            {workspace ? t('common.save') : t('workspace.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={handleKeyDown}
      >
        <Input
          label={t('workspace.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('workspace.namePlaceholder')}
          error={nameError}
          autoComplete="off"
          data-autofocus
        />
        <Textarea
          label={t('workspace.description')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('workspace.descriptionPlaceholder')}
        />
        {error && !nameError ? (
          <p role="alert" className="text-meta text-fg">
            {error.detail}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
