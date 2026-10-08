import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateList, useUpdateList } from '../../hooks/useLists';
import { fieldError, toApiError, type ApiError } from '../../lib/api';
import { useUI } from '../../stores/UIContext';
import type { TaskList } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Textarea';

export interface ListFormModalProps {
  open: boolean;
  workspaceId: number;
  /** Pass a list to edit; omit to create. */
  list?: TaskList | null;
  onClose: () => void;
}

/** Create + edit a TaskList ("清单 / 阶段", api.md §3). */
export function ListFormModal({
  open,
  workspaceId,
  list = null,
  onClose,
}: ListFormModalProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const formId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<ApiError | null>(null);

  const createMutation = useCreateList();
  const updateMutation = useUpdateList();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? '');
    setDescription(list?.description ?? '');
    setNameError(undefined);
    setError(null);
  }, [open, list]);

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
      if (list) {
        await updateMutation.mutateAsync({
          id: list.id,
          payload: { name: trimmed, description },
        });
        push({ type: 'success', message: t('list.updated') });
      } else {
        await createMutation.mutateAsync({
          workspace: workspaceId,
          name: trimmed,
          description,
        });
        push({ type: 'success', message: t('list.created') });
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
      title={list ? t('list.editTitle') : t('list.newTitle')}
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
            {list ? t('common.save') : t('list.create')}
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
          label={t('list.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('list.namePlaceholder')}
          error={nameError}
          autoComplete="off"
          data-autofocus
        />
        <Textarea
          label={t('list.description')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('list.descriptionPlaceholder')}
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
