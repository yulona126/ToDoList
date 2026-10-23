import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DiagramViewport } from '../components/architecture/DiagramViewport';
import { MermaidPreview } from '../components/architecture/MermaidPreview';
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
  useArchitecture,
  useDeleteArchitecture,
  useDeleteArchitectureImage,
  useUpdateArchitecture,
  useUploadArchitectureImage,
} from '../hooks/useArchitecture';
import { useWorkspace } from '../hooks/useWorkspaces';
import { toApiError } from '../lib/api';
import {
  readLocalMarkdownFile,
  titleFromFilename,
} from '../lib/markdown';
import { cn } from '../lib/utils';
import { useUI } from '../stores/UIContext';
import type { ArchitecturePreferred } from '../types';

const IMAGE_EXT = /\.(png|jpe?g|webp|svg|gif)$/i;
const MERMAID_EXT = /\.(mmd|mermaid|md|txt)$/i;

const DEFAULT_MERMAID = `flowchart LR
  client[Browser / Cursor] --> api[Django API]
  api --> db[(PostgreSQL)]
`;

/**
 * One architecture diagram per workspace: large pan/zoom preview + editable Mermaid.
 */
export function ArchitecturePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { push } = useUI();
  const { workspaceId: workspaceIdParam } = useParams<{ workspaceId: string }>();
  const workspaceId = Number(workspaceIdParam);
  const valid = Number.isFinite(workspaceId) && workspaceId > 0;

  const workspaceQuery = useWorkspace(valid ? workspaceId : 0);
  const architectureQuery = useArchitecture(valid ? workspaceId : 0);
  const updateArchitecture = useUpdateArchitecture();
  const uploadImage = useUploadArchitectureImage();
  const deleteImage = useDeleteArchitectureImage();
  const deleteArchitecture = useDeleteArchitecture();

  const [title, setTitle] = useState('');
  const [mermaid, setMermaid] = useState('');
  const [preferred, setPreferred] = useState<ArchitecturePreferred>('mermaid');
  const [clearOpen, setClearOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [imageOpen, setImageOpen] = useState(false);
  const [normalizedHint, setNormalizedHint] = useState(false);
  const panelsInitialized = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mermaidInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const data = architectureQuery.data;
    if (!data) return;
    setTitle(data.title);
    setMermaid(data.mermaid);
    setPreferred(data.preferred);
    // First load: keep the stage dominant when content already exists.
    if (!panelsInitialized.current) {
      panelsInitialized.current = true;
      setSourceOpen(!data.has_content);
      setImageOpen(Boolean(data.image_url) && data.preferred === 'image');
    }
  }, [architectureQuery.data]);

  const reportError = useCallback(
    (error: unknown) => {
      push({ type: 'error', message: toApiError(error).detail });
    },
    [push],
  );

  const dirty =
    architectureQuery.data !== undefined &&
    (title !== (architectureQuery.data.title ?? '') ||
      mermaid !== (architectureQuery.data.mermaid ?? '') ||
      preferred !== architectureQuery.data.preferred);

  const handleSave = () => {
    updateArchitecture.mutate(
      {
        workspaceId,
        payload: { title: title.trim(), mermaid, preferred },
      },
      {
        onSuccess: () => {
          push({ type: 'success', message: t('architecture.saved') });
        },
        onError: reportError,
      },
    );
  };

  const handleImportMermaid = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!MERMAID_EXT.test(file.name)) {
      push({ type: 'error', message: t('architecture.importMermaidTypeError') });
      return;
    }
    try {
      let text = await readLocalMarkdownFile(file);
      const fence = /```(?:mermaid)?\s*([\s\S]*?)```/i.exec(text);
      if (fence) text = fence[1].trim();
      setMermaid(text);
      if (!title.trim()) setTitle(titleFromFilename(file.name));
      setPreferred('mermaid');
      setSourceOpen(true);
      push({ type: 'success', message: t('architecture.importMermaidSuccess') });
    } catch {
      push({ type: 'error', message: t('architecture.importMermaidError') });
    }
  };

  const handleUploadImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!IMAGE_EXT.test(file.name) && !file.type.startsWith('image/')) {
      push({ type: 'error', message: t('architecture.imageTypeError') });
      return;
    }
    uploadImage.mutate(
      { workspaceId, file },
      {
        onSuccess: (data) => {
          setPreferred(data.preferred);
          setTitle(data.title || title);
          setImageOpen(true);
          push({ type: 'success', message: t('architecture.imageUploaded') });
        },
        onError: reportError,
      },
    );
  };

  if (!valid || workspaceQuery.isError) {
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

  if (workspaceQuery.isPending || architectureQuery.isPending) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-fg-subtle"
        role="status"
      >
        <Spinner size={20} />
      </div>
    );
  }

  const imageUrl = architectureQuery.data?.image_url ?? null;
  const showImagePreview = preferred === 'image' && Boolean(imageUrl);
  const previewEmpty = showImagePreview ? !imageUrl : !mermaid.trim();
  // Only remount-fit when switching preview mode / image, not on every keystroke.
  const viewportKey = showImagePreview ? `img:${imageUrl ?? ''}` : 'mmd';

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PageHeader
        backLabel={t('nav.backToWorkspace')}
        onBack={() => navigate(`/w/${workspaceId}`)}
        title={t('architecture.title')}
        titleMeta={
          dirty ? (
            <Badge variant="muted">{t('architecture.unsaved')}</Badge>
          ) : architectureQuery.data?.has_content ? (
            <Badge variant="muted">{t('architecture.savedBadge')}</Badge>
          ) : (
            <Badge variant="outline">{t('architecture.emptyBadge')}</Badge>
          )
        }
        description={
          <>
            {workspaceQuery.data?.name} · {t('architecture.onePerWorkspace')}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<Icon name="trash" size={13} />}
              onClick={() => setClearOpen(true)}
              disabled={!architectureQuery.data?.has_content}
            >
              {t('architecture.clear')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={updateArchitecture.isPending}
              disabled={!dirty}
              onClick={handleSave}
            >
              {t('common.save')}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Input
          label={t('architecture.titleLabel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('architecture.titlePlaceholder')}
          maxLength={200}
        />
        <Select
          label={t('architecture.preferred')}
          value={preferred}
          onChange={(event) =>
            setPreferred(event.target.value as ArchitecturePreferred)
          }
          options={[
            { value: 'mermaid', label: t('architecture.preferredMermaid') },
            { value: 'image', label: t('architecture.preferredImage') },
          ]}
        />
      </div>

      {/* Primary stage: large pan/zoom preview */}
      <div className="flex flex-col gap-1.5">
        <DiagramViewport
          className="h-[min(72vh,820px)] min-h-[420px] w-full"
          contentKey={viewportKey}
          empty={previewEmpty}
          toolbarExtra={
            showImagePreview ? (
              <Badge variant="outline">{t('architecture.preferredImage')}</Badge>
            ) : (
              <Badge variant="outline">{t('architecture.preferredMermaid')}</Badge>
            )
          }
        >
          {previewEmpty ? (
            <span>{t('architecture.previewEmpty')}</span>
          ) : showImagePreview && imageUrl ? (
            <img
              src={imageUrl}
              alt={title || t('architecture.title')}
              className="block max-w-none select-none"
              draggable={false}
              onLoad={() => setNormalizedHint(false)}
            />
          ) : (
            <MermaidPreview
              source={mermaid}
              onRendered={({ normalized }) => setNormalizedHint(normalized)}
            />
          )}
        </DiagramViewport>
        {normalizedHint && !showImagePreview ? (
          <p className="text-meta text-fg-subtle">
            {t('architecture.renderNormalized')}
          </p>
        ) : null}
      </div>

      {/* Secondary: collapsible Mermaid source */}
      <section className="rounded-card border border-border bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={sourceOpen}
          onClick={() => setSourceOpen((open) => !open)}
        >
          <div className="min-w-0">
            <h2 className="text-card-title font-semibold">
              {t('architecture.mermaidHeading')}
            </h2>
            <p className="text-meta text-fg-subtle">
              {t('architecture.mermaidHint')}
            </p>
          </div>
          <Icon
            name="chevron-down"
            size={16}
            className={cn(
              'shrink-0 text-fg-muted transition-transform',
              sourceOpen && 'rotate-180',
            )}
          />
        </button>

        {sourceOpen ? (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={mermaidInputRef}
                type="file"
                accept=".mmd,.mermaid,.md,.txt,text/plain,text/markdown"
                className="sr-only"
                onChange={(event) => {
                  void handleImportMermaid(event);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => mermaidInputRef.current?.click()}
              >
                {t('architecture.importMermaid')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!mermaid.trim()) setMermaid(DEFAULT_MERMAID);
                }}
              >
                {t('architecture.insertTemplate')}
              </Button>
            </div>
            <Textarea
              value={mermaid}
              onChange={(event) => setMermaid(event.target.value)}
              placeholder={t('architecture.mermaidPlaceholder')}
              rows={14}
              className="min-h-[220px] font-mono text-secondary"
            />
          </div>
        ) : null}
      </section>

      {/* Optional image */}
      <section className="rounded-card border border-border bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={imageOpen}
          onClick={() => setImageOpen((open) => !open)}
        >
          <div className="min-w-0">
            <h2 className="text-card-title font-semibold">
              {t('architecture.imageHeading')}
            </h2>
            <p className="text-meta text-fg-subtle">
              {imageUrl
                ? t('architecture.imageReady')
                : t('architecture.imageEmpty')}
            </p>
          </div>
          <Icon
            name="chevron-down"
            size={16}
            className={cn(
              'shrink-0 text-fg-muted transition-transform',
              imageOpen && 'rotate-180',
            )}
          />
        </button>

        {imageOpen ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
            <p className="text-secondary text-fg-muted">
              {t('architecture.imageHint')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={imageInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,.gif,image/*"
                className="sr-only"
                onChange={handleUploadImage}
              />
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name="download" size={13} />}
                loading={uploadImage.isPending}
                onClick={() => imageInputRef.current?.click()}
              >
                {t('architecture.uploadImage')}
              </Button>
              {imageUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deleteImage.isPending}
                  onClick={() =>
                    deleteImage.mutate(workspaceId, {
                      onSuccess: () =>
                        push({
                          type: 'success',
                          message: t('architecture.imageDeleted'),
                        }),
                      onError: reportError,
                    })
                  }
                >
                  {t('architecture.removeImage')}
                </Button>
              ) : null}
              {imageUrl && preferred !== 'image' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreferred('image')}
                >
                  {t('architecture.showImageInPreview')}
                </Button>
              ) : null}
            </div>
            {imageUrl ? (
              <div className="flex justify-center rounded-control border border-border bg-surface-muted p-3">
                <img
                  src={imageUrl}
                  alt={title || t('architecture.title')}
                  className="max-h-[200px] max-w-full object-contain"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={clearOpen}
        title={t('architecture.clearConfirmTitle')}
        description={t('architecture.clearConfirmBody')}
        confirmLabel={t('architecture.clear')}
        confirmVariant="danger"
        loading={deleteArchitecture.isPending}
        onConfirm={() => {
          deleteArchitecture.mutate(workspaceId, {
            onSuccess: () => {
              setTitle('');
              setMermaid('');
              setPreferred('mermaid');
              setClearOpen(false);
              push({ type: 'success', message: t('architecture.cleared') });
            },
            onError: reportError,
          });
        }}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
