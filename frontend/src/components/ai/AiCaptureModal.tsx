import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useTags } from '../../hooks/useTags';
import { useLists } from '../../hooks/useLists';
import {
  useAiCredential,
  useAiParse,
  useBulkCreateTasks,
} from '../../hooks/useAi';
import type { ParsedDraft, ParsedTextResult } from '../../lib/aiApi';
import { toApiError } from '../../lib/api';
import { localParse } from '../../lib/localParse';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { todayIso } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { BulkCreateItem } from '../../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Textarea } from '../ui/Textarea';
import {
  AiDraftList,
  captureDraftMeta,
  type CaptureDraft,
} from './AiDraftList';
import { AiUsageBadge } from './AiUsageBadge';

export interface AiCaptureModalProps {
  open: boolean;
  workspaceId: number;
  /** Fallback list for drafts that do not name one (the focused list, if any). */
  defaultListId?: number | null;
  onClose: () => void;
}

/** Prompt tokens are roughly constant (T2: the static prefix is cached). */
const PROMPT_TOKEN_ESTIMATE = 150;
/** T7 in ai-assistant.md §2 — the completion budget for one call. */
function completionBudget(draftCount: number): number {
  return Math.min(400, 120 + 60 * Math.max(1, draftCount));
}

/**
 * AI capture panel (docs/ai-assistant.md §3.2).
 *
 * The important property is that typing never costs anything: the textarea is
 * mirrored by the local rule parser (debounced ~150ms) and the user only pays
 * for a model call when they explicitly ask for one or the input looks like
 * prose worth escalating (T1). Confirmation is the single write.
 */
export function AiCaptureModal({
  open,
  workspaceId,
  defaultListId = null,
  onClose,
}: AiCaptureModalProps) {
  const { t } = useTranslation();
  const { push } = useUI();

  const listsQuery = useLists(workspaceId);
  const tagsQuery = useTags(workspaceId, open);
  const aiParse = useAiParse();
  const bulkCreate = useBulkCreateTasks();
  const credentialQuery = useAiCredential(open);
  const credential = credentialQuery.data;

  const [text, setText] = useState('');
  const [aiResult, setAiResult] = useState<ParsedTextResult | null>(null);
  const [aiDrafts, setAiDrafts] = useState<CaptureDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const debouncedText = useDebouncedValue(text, 150);
  const sequence = useRef(0);

  /* Fresh panel every time it opens: drafts are deliberately ephemeral (§4.3). */
  useEffect(() => {
    if (!open) return;
    setText('');
    setAiResult(null);
    setAiDrafts([]);
    setSubmitting(false);
    sequence.current = 0;
  }, [open]);

  const lists = useMemo(() => listsQuery.data?.results ?? [], [listsQuery.data]);

  const listIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const list of lists) map.set(list.name.toLowerCase(), list.id);
    return map;
  }, [lists]);

  const unknownListLabel = t('ai.warnings.listNotFound');

  const localResult = useMemo(
    () =>
      localParse(debouncedText, {
        lists,
        tags: tagsQuery.data?.results ?? [],
        today: todayIso(),
        unknownListLabel,
      }),
    [debouncedText, lists, tagsQuery.data, unknownListLabel],
  );

  const nextId = (prefix: string): string => {
    sequence.current += 1;
    return `${prefix}-${sequence.current}`;
  };

  const toCaptureDraft = useCallback(
    (draft: ParsedDraft, prefix: string): CaptureDraft => ({
      id: nextId(prefix),
      selected: true,
      expanded: false,
      title: draft.title,
      listId:
        draft.listId ??
        (draft.listName
          ? (listIdByName.get(draft.listName.toLowerCase()) ?? null)
          : null),
      listName: draft.listName,
      priority: draft.priority,
      taskType: draft.taskType,
      dueDate: draft.dueDate,
      tagIds: draft.tagIds,
      tagNames: draft.tagNames,
      subtasks: draft.subtasks,
    }),
    [listIdByName],
  );

  /**
   * The instant, free preview: exactly what the marker rules would create, and
   * exactly what the server returns for `mode=local`. No guessing — if the
   * user did not ask for AI, unmarked prose stays one task.
   */
  const localDrafts = useMemo<CaptureDraft[]>(
    () =>
      localResult.drafts.map((draft, index) => ({
        id: `local-${index}`,
        selected: true,
        expanded: false,
        title: draft.t,
        listId: draft.listName
          ? (listIdByName.get(draft.listName.toLowerCase()) ?? null)
          : null,
        listName: draft.listName,
        priority: draft.priority,
        taskType: draft.taskType,
        dueDate: draft.dueDate,
        tagIds: [],
        tagNames: draft.tagNames,
        subtasks: [],
      })),
    [localResult.drafts, listIdByName],
  );

  // The AI button must genuinely reach the model, so it is only offered when a
  // key exists — otherwise clicking it would just produce a 400.
  const aiReady = Boolean(credential?.key_mask) && credential?.is_active === true;

  const hasAiResult = aiResult !== null;
  const checkedCount = hasAiResult
    ? aiDrafts.filter((draft) => draft.selected).length
    : localDrafts.length;
  const pending = aiParse.isPending || submitting;

  const warningMessages = useMemo(() => {
    if (aiResult) return aiResult.warnings.map((warning) => warning.message);
    return localResult.warnings;
  }, [aiResult, localResult.warnings]);

  const estimatedTokens = PROMPT_TOKEN_ESTIMATE + completionBudget(localDrafts.length);

  const handleClose = useCallback(() => {
    setText('');
    setAiResult(null);
    setAiDrafts([]);
    onClose();
  }, [onClose]);

  const handleChange = (value: string): void => {
    setText(value);
    // Editing the text invalidates a previous analysis rather than silently
    // creating tasks from a stale result.
    if (aiResult) {
      setAiResult(null);
      setAiDrafts([]);
    }
  };

  const runAnalysis = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || aiParse.isPending) return;
    try {
      const result = await aiParse.mutateAsync({
        workspace: workspaceId,
        text: trimmed,
        mode: 'ai',
        default_list: defaultListId ?? undefined,
      });
      setAiResult(result);
      setAiDrafts(result.drafts.map((draft) => toCaptureDraft(draft, 'ai')));
    } catch (error) {
      push({ type: 'error', message: toApiError(error).detail });
    }
  };

  const confirm = async (): Promise<void> => {
    if (pending) return;
    const chosen = hasAiResult
      ? aiDrafts.filter((draft) => draft.selected)
      : localDrafts;
    if (chosen.length === 0) return;

    setSubmitting(true);
    try {
      const tasks: BulkCreateItem[] = [];
      for (const draft of chosen) {
        const title = draft.title.trim();
        if (!title) continue;
        tasks.push({
          workspace: workspaceId,
          task_list: draft.listId ?? defaultListId ?? null,
          title,
          ...(draft.priority ? { priority: draft.priority } : {}),
          ...(draft.taskType ? { task_type: draft.taskType } : {}),
          ...(draft.dueDate ? { due_date: draft.dueDate } : {}),
          // Names cover tags that do not exist yet; the server get_or_creates
          // them, which is exactly what the `#tag` grammar promises.
          ...(draft.tagIds.length > 0 ? { tag_ids: draft.tagIds } : {}),
          ...(draft.tagNames.length > 0 ? { tag_names: draft.tagNames } : {}),
          ...(draft.subtasks.length > 0 ? { subtasks: draft.subtasks } : {}),
        });
      }

      if (tasks.length === 0) {
        setSubmitting(false);
        return;
      }

      const result = await bulkCreate.mutateAsync({ tasks });
      push({
        type: 'success',
        message: t('ai.createSuccess', { total: result.created }),
      });
      handleClose();
    } catch (error) {
      push({ type: 'error', message: toApiError(error).detail });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    event.preventDefault();
    // Cmd/Ctrl+Enter creates when there is something to create, and otherwise
    // falls back to "analyse this prose".
    if (
      checkedCount > 0 &&
      (hasAiResult || !localResult.shouldEscalate)
    ) {
      void confirm();
      return;
    }
    void runAnalysis();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('ai.captureTitle')}
      description={t('ai.captureDescription')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void confirm()}
            disabled={checkedCount === 0 || submitting}
            loading={submitting}
          >
            {t('ai.createCount', { total: checkedCount })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
        <Textarea
          label={t('ai.captureInputLabel')}
          value={text}
          rows={5}
          data-autofocus
          autoComplete="off"
          placeholder={t('ai.capturePlaceholder')}
          onChange={(event) => handleChange(event.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="compass" size={13} />}
            loading={aiParse.isPending}
            disabled={text.trim().length === 0 || pending || !aiReady}
            onClick={() => void runAnalysis()}
          >
            {aiParse.isPending ? t('ai.analysing') : t('ai.analyse')}
          </Button>

          {!aiReady && !credentialQuery.isPending ? (
            <span className="text-meta text-fg-muted">{t('ai.notConfigured')}</span>
          ) : aiParse.isPending ? (
            <span className="text-meta text-fg-subtle">
              {t('ai.estimateNote', { tokens: estimatedTokens })}
            </span>
          ) : (
            <span className="text-meta text-fg-subtle">
              {localResult.shouldEscalate
                ? t('ai.proseHint')
                : t('ai.analyseHint')}
            </span>
          )}
        </div>

        {!hasAiResult && text.trim() ? (
          <div className="flex flex-col gap-1.5">
            {localDrafts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {localDrafts.map((draft) => {
                  const meta = captureDraftMeta(draft, (key) => String(t(key)));
                  return (
                    <span
                      key={draft.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-pill border border-border bg-surface-muted px-2 py-0.5 text-meta text-fg"
                    >
                      <span className="truncate">{draft.title}</span>
                      {meta.length > 0 ? (
                        <span className="truncate text-fg-muted">
                          {' · '}
                          {meta.join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ) : null}

            <p className="text-meta text-fg-muted">
              {localDrafts.length > 0
                ? t('ai.localPreviewHint', { total: localDrafts.length })
                : t('ai.localPreviewEmpty')}
            </p>
          </div>
        ) : null}

        {hasAiResult ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-secondary font-medium text-fg">
                {t('ai.draftListTitle')}
              </span>
              {/* A `local` source means the server resolved it with rules and
                  billed nothing, so there is no usage worth showing. */}
              {aiResult.source === 'ai' ? (
                <AiUsageBadge
                  usage={aiResult.usage}
                  latencyMs={aiResult.latencyMs}
                />
              ) : null}
            </div>
            <AiDraftList
              drafts={aiDrafts}
              lists={lists}
              onChange={(id, patch) =>
                setAiDrafts((current) =>
                  current.map((draft) =>
                    draft.id === id ? { ...draft, ...patch } : draft,
                  ),
                )
              }
            />
          </div>
        ) : null}

        {warningMessages.length > 0 ? (
          <div className="flex items-start gap-2 rounded-control border border-border px-2.5 py-2 text-meta text-fg-muted">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-fg-subtle" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium text-fg">
                {t('ai.warningsTitle', { total: warningMessages.length })}
              </span>
              {warningMessages.map((message, index) => (
                <span key={`${index}-${message}`} className="break-words">
                  {message}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
