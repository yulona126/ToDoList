import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from '../../hooks/useApiTokens';
import { toApiError } from '../../lib/api';
import { formatDate, formatRelative } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { ApiToken, ApiTokenCreateResult } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select, type SelectOption } from '../ui/Select';
import { Spinner } from '../ui/Spinner';

/** Sensible default for the first (and most common) use case: a Cursor MCP server. */
const DEFAULT_NAME = 'cursor-mcp';

type ExpiryValue = 'never' | '30' | '90' | '365';

const EXPIRY_DAYS: Record<Exclude<ExpiryValue, 'never'>, number> = {
  '30': 30,
  '90': 90,
  '365': 365,
};

function expiryToDays(value: ExpiryValue): number | null {
  return value === 'never' ? null : EXPIRY_DAYS[value];
}

/**
 * Settings → API Tokens (api.md §1, "API Tokens `/auth/tokens`").
 *
 * Personal access tokens are long-lived credentials for tools that cannot use
 * the browser's 60-minute JWT (Cursor MCP, a CLI, CI). The whole UI is shaped
 * by one constraint: **the plaintext exists in the POST response once and can
 * never be read again**.
 *
 * That is why:
 *  - the create response is copied straight into component state and the
 *    mutation (`gcTime: 0`) is `reset()` immediately — no query/mutation cache
 *    ever holds the secret, and nothing touches localStorage;
 *  - `reveal` is the only copy of the plaintext, and every close path clears it;
 *  - revoked rows stay in the list (the server keeps them for audit) with the
 *    revoke button hidden instead of disappearing.
 */
export function ApiTokensSection() {
  const { t } = useTranslation();
  const { push } = useUI();

  const tokensQuery = useApiTokens();
  const createToken = useCreateApiToken();
  const revokeToken = useRevokeApiToken();

  const tokens = tokensQuery.data?.results ?? [];

  const formId = useId();
  const revealRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  /** The one-time plaintext, held in component state only. */
  const [reveal, setReveal] = useState<ApiTokenCreateResult | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [expiry, setExpiry] = useState<ExpiryValue>('never');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  // The create form unmounts when the reveal state replaces it, so move focus
  // onto the secret box ourselves instead of dropping it to `document.body`.
  useEffect(() => {
    if (reveal) revealRef.current?.focus();
  }, [reveal]);

  const expiryOptions: SelectOption[] = [
    { value: 'never', label: t('tokens.expiryNever') },
    { value: '30', label: t('tokens.expiry30') },
    { value: '90', label: t('tokens.expiry90') },
    { value: '365', label: t('tokens.expiry365') },
  ];

  const openCreate = (): void => {
    setName(DEFAULT_NAME);
    setExpiry('never');
    setNameError(undefined);
    setCopied(false);
    setManualCopy(false);
    setReveal(null);
    setCreateOpen(true);
  };

  /** Every close path goes through here, so the plaintext never outlives the modal. */
  const closeCreate = (): void => {
    setReveal(null);
    setCreateOpen(false);
    setName(DEFAULT_NAME);
    setExpiry('never');
    setNameError(undefined);
    setCopied(false);
    setManualCopy(false);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  };

  const submitCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('tokens.nameRequired'));
      return;
    }
    setNameError(undefined);
    try {
      const created = await createToken.mutateAsync({
        name: trimmed,
        expires_in_days: expiryToDays(expiry),
      });
      // The only reference to the plaintext from here on is this state value.
      setReveal(created);
    } catch (error) {
      push({ type: 'error', message: toApiError(error).detail });
    } finally {
      // `mutateAsync` also stores its result in the mutation cache; drop it as
      // soon as it has been copied into component state.
      createToken.reset();
    }
  };

  const selectRevealText = (): void => {
    const node = revealRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copyToken = async (): Promise<void> => {
    const value = reveal?.token;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy(false);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      // `navigator.clipboard` is unavailable on insecure origins (this app runs
      // on plain HTTP), so select the text and tell the user to copy manually.
      setCopied(false);
      setManualCopy(true);
      selectRevealText();
    }
  };

  const confirmRevoke = (): void => {
    const target = revokeTarget;
    if (!target) return;
    revokeToken.mutate(target.id, {
      onSuccess: () => {
        setRevokeTarget(null);
        push({ type: 'success', message: t('tokens.revokeSuccess') });
      },
      onError: (error) => {
        setRevokeTarget(null);
        push({ type: 'error', message: toApiError(error).detail });
      },
    });
  };

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-card-title font-semibold text-fg">
            {t('tokens.settingsTitle')}
          </h2>
          <p className="mt-0.5 text-secondary text-fg-muted">
            {t('tokens.settingsDescription')}
          </p>
        </div>
        <Button
          variant="primary"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={openCreate}
        >
          {t('tokens.createButton')}
        </Button>
      </div>

      <p className="mt-2 text-meta text-fg-subtle">
        {t('tokens.docsHint')}
        <span className="underline underline-offset-2">
          docs/mcp-and-skills.md
        </span>
        {t('tokens.docsHintSuffix')}
      </p>

      <div className="mt-3">
        {tokensQuery.isPending ? (
          <div className="flex items-center gap-2 text-meta text-fg-subtle">
            <Spinner size={12} />
            {t('common.loading')}
          </div>
        ) : tokensQuery.isError ? (
          <p className="text-meta text-fg-subtle">{t('tokens.listUnavailable')}</p>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-control border border-dashed border-border p-3">
            <p className="text-meta text-fg-muted">{t('tokens.emptyState')}</p>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="plus" size={12} />}
              onClick={openCreate}
            >
              {t('tokens.createButton')}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-fg">
                      {token.name}
                    </span>
                    <span className="truncate font-mono text-meta text-fg-muted">
                      {token.prefix}…
                    </span>
                    {token.is_active ? null : (
                      <Badge variant="muted">{t('tokens.inactive')}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-meta text-fg-muted">
                    {t('tokens.createdAt', {
                      date: formatDate(token.created_at),
                    })}
                    {' · '}
                    {token.last_used_at
                      ? t('tokens.lastUsed', {
                          time: formatRelative(token.last_used_at),
                        })
                      : t('tokens.neverUsed')}
                    {' · '}
                    {token.expires_at
                      ? t('tokens.expiresAt', {
                          date: formatDate(token.expires_at),
                        })
                      : t('tokens.neverExpires')}
                  </p>
                </div>
                {token.is_active ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setRevokeTarget(token)}
                  >
                    {t('tokens.revoke')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title={reveal ? t('tokens.revealTitle') : t('tokens.createTitle')}
        description={reveal ? undefined : t('tokens.createDescription')}
        size="sm"
        footer={
          reveal ? (
            <Button variant="primary" onClick={closeCreate}>
              {t('tokens.revealDone')}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={closeCreate}
                disabled={createToken.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                loading={createToken.isPending}
              >
                {t('tokens.submit')}
              </Button>
            </>
          )
        }
      >
        {reveal ? (
          <div className="flex flex-col gap-3">
            <p className="text-secondary text-fg-muted">
              {t('tokens.revealBody')}
            </p>

            <div
              ref={revealRef}
              role="textbox"
              aria-readonly="true"
              aria-label={t('tokens.revealBoxLabel')}
              tabIndex={0}
              className="w-full overflow-x-auto rounded-control border border-border bg-surface-muted px-3 py-2 font-mono text-meta break-all text-fg select-all"
            >
              {reveal.token}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={copied ? <Icon name="check" size={12} /> : undefined}
                onClick={() => void copyToken()}
              >
                {t('tokens.copy')}
              </Button>
              <span
                className="text-meta text-fg-muted"
                role="status"
                aria-live="polite"
              >
                {copied ? t('tokens.copied') : ''}
              </span>
            </div>

            {manualCopy ? (
              <p className="text-meta text-fg" role="status">
                {t('tokens.copyManual')}
              </p>
            ) : null}

            <div className="flex gap-2 rounded-control border border-border p-2.5">
              <Icon name="alert" size={14} className="mt-0.5 text-fg-muted" />
              <p className="text-meta text-fg-muted">
                {t('tokens.revealWarning')}
              </p>
            </div>
          </div>
        ) : (
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <Input
              label={t('tokens.nameLabel')}
              value={name}
              error={nameError}
              hint={t('tokens.nameHint')}
              placeholder={DEFAULT_NAME}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              onChange={(event) => setName(event.target.value)}
            />
            <Select
              label={t('tokens.expiryLabel')}
              value={expiry}
              options={expiryOptions}
              onChange={(event) =>
                setExpiry(event.target.value as ExpiryValue)
              }
            />
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t('tokens.revokeConfirmTitle')}
        description={t('tokens.revokeConfirmBody', {
          name: revokeTarget?.name ?? '',
        })}
        confirmLabel={t('tokens.revoke')}
        confirmVariant="danger"
        loading={revokeToken.isPending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
      />
    </section>
  );
}
