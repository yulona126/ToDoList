import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { MarkdownPreview } from '../components/documents/MarkdownPreview';
import { PageHeader } from '../components/layout/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { Textarea } from '../components/ui/Textarea';
import {
  useCreateDocument,
  useDeleteDocument,
  useDocuments,
  useUpdateDocument,
} from '../hooks/useDocuments';
import { useWorkspace } from '../hooks/useWorkspaces';
import { toApiError } from '../lib/api';
import {
  DOCUMENT_KIND_LABEL_KEY,
  DOCUMENT_KIND_VALUES,
  DOCUMENT_STATUS_LABEL_KEY,
  DOCUMENT_STATUS_VALUES,
  DocumentKind,
  DocumentStatus,
} from '../lib/constants';
import {
  readLocalMarkdownFile,
  titleFromFilename,
} from '../lib/markdown';
import { cn } from '../lib/utils';
import { useUI } from '../stores/UIContext';
import type { Document } from '../types';

type BodyMode = 'edit' | 'preview';

const MD_EXTENSIONS = /\.(md|markdown|txt)$/i;

interface EditorState {
  title: string;
  body: string;
  kind: DocumentKind;
  status: DocumentStatus;
  path: string;
}

function toEditorState(doc: Document | null): EditorState {
  return {
    title: doc?.title ?? '',
    body: doc?.body ?? '',
    kind: doc?.kind ?? DocumentKind.Plan,
    status: doc?.status ?? DocumentStatus.Active,
    path: doc?.path ?? '',
  };
}

/**
 * Workspace documents board: left list + right Markdown editor.
 * Plans / notes live in the DB (not as git file copies).
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { push } = useUI();
  const { workspaceId: workspaceIdParam, docId: docIdParam } = useParams<{
    workspaceId: string;
    docId?: string;
  }>();

  const workspaceId = Number(workspaceIdParam);
  const selectedId = docIdParam ? Number(docIdParam) : null;
  const validWorkspaceId = Number.isFinite(workspaceId) && workspaceId > 0;

  const workspaceQuery = useWorkspace(validWorkspaceId ? workspaceId : 0);
  const documentsQuery = useDocuments(validWorkspaceId ? workspaceId : 0);
  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();

  const documents = documentsQuery.data?.results ?? [];
  const selected = useMemo(
    () =>
      selectedId !== null
        ? (documents.find((doc) => doc.id === selectedId) ?? null)
        : null,
    [documents, selectedId],
  );

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<EditorState>(() => toEditorState(null));
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);
  const [bodyMode, setBodyMode] = useState<BodyMode>('edit');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) {
      setDraft(toEditorState(null));
      setBodyMode('edit');
      return;
    }
    setDraft(toEditorState(selected));
    setBodyMode('edit');
  }, [creating, selected]);

  const reportError = useCallback(
    (error: unknown) => {
      push({ type: 'error', message: toApiError(error).detail });
    },
    [push],
  );

  const dirty = useMemo(() => {
    if (creating) {
      return (
        draft.title.trim().length > 0 ||
        draft.body.length > 0 ||
        draft.path.length > 0 ||
        draft.kind !== DocumentKind.Plan ||
        draft.status !== DocumentStatus.Active
      );
    }
    if (!selected) return false;
    return (
      draft.title !== selected.title ||
      draft.body !== selected.body ||
      draft.kind !== selected.kind ||
      draft.status !== selected.status ||
      draft.path !== selected.path
    );
  }, [creating, draft, selected]);

  const openCreate = () => {
    setCreating(true);
    navigate(`/w/${workspaceId}/docs`);
  };

  const selectDoc = (id: number) => {
    setCreating(false);
    navigate(`/w/${workspaceId}/docs/${id}`);
  };

  const handleImportMd = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file later.
    event.target.value = '';
    if (!file) return;

    if (!MD_EXTENSIONS.test(file.name) && file.type && !file.type.startsWith('text/')) {
      push({ type: 'error', message: t('document.importMdTypeError') });
      return;
    }

    try {
      const text = await readLocalMarkdownFile(file);
      setDraft((current) => ({
        ...current,
        body: text,
        title: current.title.trim()
          ? current.title
          : titleFromFilename(file.name),
      }));
      setBodyMode('edit');
      push({ type: 'success', message: t('document.importMdSuccess') });
    } catch {
      push({ type: 'error', message: t('document.importMdError') });
    }
  };

  const handleSave = () => {
    const title = draft.title.trim();
    if (!title) {
      push({ type: 'error', message: t('validation.titleRequired') });
      return;
    }

    if (creating) {
      createDocument.mutate(
        {
          workspace: workspaceId,
          title,
          body: draft.body,
          kind: draft.kind,
          status: draft.status,
          path: draft.path.trim(),
        },
        {
          onSuccess: (doc) => {
            push({ type: 'success', message: t('document.created') });
            setCreating(false);
            navigate(`/w/${workspaceId}/docs/${doc.id}`);
          },
          onError: reportError,
        },
      );
      return;
    }

    if (!selected) return;
    updateDocument.mutate(
      {
        id: selected.id,
        payload: {
          title,
          body: draft.body,
          kind: draft.kind,
          status: draft.status,
          path: draft.path.trim(),
        },
      },
      {
        onSuccess: () => {
          push({ type: 'success', message: t('document.updated') });
        },
        onError: reportError,
      },
    );
  };

  if (!validWorkspaceId) {
    return (
      <EmptyState
        icon="compass"
        title={t('workspace.notFound')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('pages.notFoundAction')}
          </Button>
        }
      />
    );
  }

  if (workspaceQuery.isError) {
    return (
      <EmptyState
        icon="alert"
        title={t('workspace.notFound')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('pages.notFoundAction')}
          </Button>
        }
      />
    );
  }

  if (workspaceQuery.isPending) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-fg-subtle"
        role="status"
      >
        <Spinner size={20} />
      </div>
    );
  }

  const saving = createDocument.isPending || updateDocument.isPending;
  const showEditor = creating || selected !== null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backLabel={t('nav.backToWorkspace')}
        onBack={() => navigate(`/w/${workspaceId}`)}
        title={t('document.title')}
        description={
          <>
            {workspaceQuery.data?.name}
            {documentsQuery.data
              ? ` · ${t('common.countTotal', { total: documentsQuery.data.count })}`
              : null}
          </>
        }
        actions={
          <Button
            variant="primary"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={openCreate}
          >
            {t('document.new')}
          </Button>
        }
      />

      <div className="grid min-h-[60vh] gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-3 py-2 text-meta text-fg-subtle">
            {t('document.listHeading')}
          </div>

          {documentsQuery.isPending ? (
            <div className="flex items-center gap-2 px-3 py-4 text-meta text-fg-subtle">
              <Spinner size={12} />
              {t('common.loading')}
            </div>
          ) : null}

          {!documentsQuery.isPending && documents.length === 0 && !creating ? (
            <p className="px-3 py-4 text-secondary text-fg-muted">
              {t('document.emptyList')}
            </p>
          ) : null}

          <ul className="max-h-[70vh] overflow-y-auto p-1">
            {creating ? (
              <li>
                <div className="rounded-control bg-surface-muted px-2 py-1.5 text-secondary font-medium text-fg">
                  {t('document.newUntitled')}
                </div>
              </li>
            ) : null}
            {documents.map((doc) => {
              const active = !creating && doc.id === selectedId;
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => selectDoc(doc.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-control px-2 py-1.5 text-left motion-safe-150',
                      active
                        ? 'bg-surface-muted text-fg'
                        : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                    )}
                  >
                    <span className="truncate text-secondary font-medium">
                      {doc.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-meta text-fg-subtle">
                      <span>{t(DOCUMENT_KIND_LABEL_KEY[doc.kind])}</span>
                      {doc.status !== DocumentStatus.Active ? (
                        <span>· {t(DOCUMENT_STATUS_LABEL_KEY[doc.status])}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="rounded-card border border-border bg-surface">
          {!showEditor ? (
            <EmptyState
              icon="file"
              title={t('document.emptyTitle')}
              description={t('document.emptyBody')}
              action={
                <Button
                  variant="primary"
                  iconLeft={<Icon name="plus" size={14} />}
                  onClick={openCreate}
                >
                  {t('document.new')}
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>
                  {creating
                    ? t('document.new')
                    : `#${selected?.id ?? ''}`}
                </Badge>
                {dirty ? (
                  <span className="text-meta text-fg-muted">
                    {t('document.unsaved')}
                  </span>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {!creating && selected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Icon name="trash" size={13} />}
                      onClick={() => setPendingDelete(selected)}
                    >
                      {t('common.delete')}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    size="sm"
                    loading={saving}
                    disabled={!dirty && !creating}
                    onClick={handleSave}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>

              <Input
                label={t('document.titleLabel')}
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={t('document.titlePlaceholder')}
                maxLength={200}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={t('document.kind')}
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      kind: event.target.value as DocumentKind,
                    }))
                  }
                  options={DOCUMENT_KIND_VALUES.map((kind) => ({
                    value: kind,
                    label: t(DOCUMENT_KIND_LABEL_KEY[kind]),
                  }))}
                />
                <Select
                  label={t('document.status')}
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as DocumentStatus,
                    }))
                  }
                  options={DOCUMENT_STATUS_VALUES.map((status) => ({
                    value: status,
                    label: t(DOCUMENT_STATUS_LABEL_KEY[status]),
                  }))}
                />
              </div>

              <Input
                label={t('document.path')}
                value={draft.path}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    path: event.target.value,
                  }))
                }
                placeholder={t('document.pathPlaceholder')}
                hint={t('document.pathHint')}
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-secondary font-medium text-fg-muted">
                    {t('document.body')}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".md,.markdown,.txt,text/markdown,text/plain"
                      className="sr-only"
                      onChange={(event) => {
                        void handleImportMd(event);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Icon name="download" size={13} />}
                      onClick={() => fileInputRef.current?.click()}
                      title={t('document.importMdHint')}
                    >
                      {t('document.importMd')}
                    </Button>
                    <div
                      role="tablist"
                      aria-label={t('document.body')}
                      className="inline-flex rounded-control border border-border p-0.5"
                    >
                      {(['edit', 'preview'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          aria-selected={bodyMode === mode}
                          className={cn(
                            'rounded-[6px] px-2 py-0.5 text-meta motion-safe-150',
                            bodyMode === mode
                              ? 'bg-surface-muted font-medium text-fg'
                              : 'text-fg-muted hover:text-fg',
                          )}
                          onClick={() => setBodyMode(mode)}
                        >
                          {mode === 'edit'
                            ? t('document.modeEdit')
                            : t('document.modePreview')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {bodyMode === 'edit' ? (
                  <>
                    <Textarea
                      value={draft.body}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          body: event.target.value,
                        }))
                      }
                      placeholder={t('document.bodyPlaceholder')}
                      rows={18}
                      className="font-mono text-secondary"
                    />
                    <p className="text-meta text-fg-subtle">
                      {t('document.importMdHint')}
                    </p>
                  </>
                ) : (
                  <div className="min-h-[320px] rounded-control border border-border bg-surface px-3 py-3">
                    <MarkdownPreview
                      source={draft.body}
                      emptyLabel={t('document.previewEmpty')}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('document.deleteConfirmTitle')}
        description={t('document.deleteConfirmBody', {
          title: pendingDelete?.title ?? '',
        })}
        confirmLabel={t('common.delete')}
        confirmVariant="danger"
        loading={deleteDocument.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteDocument.mutate(pendingDelete.id, {
            onSuccess: () => {
              push({ type: 'success', message: t('document.deleted') });
              setPendingDelete(null);
              setCreating(false);
              navigate(`/w/${workspaceId}/docs`);
            },
            onError: reportError,
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
