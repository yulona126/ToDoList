import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAiCredential,
  useAiUsage,
  useDeleteAiCredential,
  useTestAiCredential,
  useUpdateAiCredential,
} from '../../hooks/useAi';
import { toApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';
import type { AiCredentialTestResult } from '../../types';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

/**
 * Settings → AI assistant (docs/ai-assistant.md §4.1, §5).
 *
 * Three rules shape this panel:
 *  - the plaintext key is write-only: the input is always empty and the server's
 *    mask is shown as a placeholder, so a stored key is never re-rendered;
 *  - the model name is free text with `models_available` as suggestions, because
 *    the backend must not hardcode a model either (§4.1);
 *  - the usage block is the token-economy report card: cached tokens and the
 *    local-vs-AI split say out loud whether T1 is actually saving calls.
 */
export function AiSettingsSection() {
  const { t } = useTranslation();
  const { push } = useUI();

  const credentialQuery = useAiCredential();
  const usageQuery = useAiUsage(30);
  const updateCredential = useUpdateAiCredential();
  const deleteCredential = useDeleteAiCredential();
  const testCredential = useTestAiCredential();

  const credential = credentialQuery.data;
  const modelListId = useId();

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testResult, setTestResult] = useState<AiCredentialTestResult | null>(
    null,
  );
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!credential) return;
    setModel(credential.model);
    setBaseUrl(credential.base_url);
    setIsActive(credential.is_active);
  }, [credential]);

  /*
   * `configured` (server-side `usable`) is false while AI is switched off,
   * even though the key is still stored. The key's presence is what gates the
   * mask, the test button and the danger zone.
   */
  const hasKey = Boolean(credential?.key_mask);
  const saving = updateCredential.isPending;

  const save = async (): Promise<void> => {
    try {
      await updateCredential.mutateAsync({
        // Empty fields are omitted rather than sent: the server rejects a blank
        // model, and an absent `api_key` means "keep the stored key".
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
        is_active: isActive,
      });
      setApiKey('');
      setTestResult(null);
      push({ type: 'success', message: t('ai.saved') });
    } catch (error) {
      push({ type: 'error', message: toApiError(error).detail });
    }
  };

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testCredential.mutateAsync();
      setTestResult(result);
    } catch (error) {
      setTestResult({
        ok: false,
        model: '',
        latency_ms: 0,
        error: toApiError(error).detail,
      });
    } finally {
      setTesting(false);
    }
  };

  const usage = usageQuery.data;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-card-title font-semibold text-fg">
        {t('ai.settingsTitle')}
      </h2>
      <p className="mt-0.5 mb-3 text-secondary text-fg-muted">
        {t('ai.settingsDescription')}
      </p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          type="password"
          label={t('ai.apiKey')}
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey && credential ? credential.key_mask : 'sk-…'}
          hint={hasKey ? t('ai.apiKeyConfiguredHint') : t('ai.apiKeyHint')}
          onChange={(event) => setApiKey(event.target.value)}
        />

        <div className="flex flex-col gap-1">
          <Input
            label={t('ai.model')}
            value={model}
            list={modelListId}
            autoComplete="off"
            spellCheck={false}
            hint={t('ai.modelHint')}
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id={modelListId}>
            {(credential?.models_available ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((current) => !current)}
            className="flex w-fit items-center gap-1 rounded-control text-meta text-fg-muted motion-safe-150 hover:text-fg"
          >
            <Icon
              name={advancedOpen ? 'chevron-down' : 'chevron-right'}
              size={12}
            />
            {t('ai.advanced')}
          </button>

          {advancedOpen ? (
            <Input
              label={t('ai.baseUrl')}
              value={baseUrl}
              autoComplete="off"
              spellCheck={false}
              hint={t('ai.baseUrlHint')}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-secondary text-fg-muted">{t('ai.enabled')}</span>
          <Button
            variant={isActive ? 'primary' : 'secondary'}
            aria-pressed={isActive}
            onClick={() => setIsActive((current) => !current)}
          >
            {isActive ? t('ai.enabledOn') : t('ai.enabledOff')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={
              credentialQuery.isPending || (!hasKey && apiKey.trim().length === 0)
            }
          >
            {t('ai.save')}
          </Button>
          <Button
            variant="secondary"
            loading={testing}
            disabled={!hasKey || credentialQuery.isPending}
            onClick={() => void runTest()}
          >
            {t('ai.test')}
          </Button>

          {testResult ? (
            <span
              className={cn(
                'text-meta',
                testResult.ok ? 'text-fg-muted' : 'text-fg',
              )}
              role="status"
            >
              {testResult.ok
                ? t('ai.testOk', {
                    model: testResult.model,
                    latency: testResult.latency_ms,
                  })
                : t('ai.testFailed', { error: testResult.error ?? '' })}
            </span>
          ) : null}
        </div>

        {!credentialQuery.isPending && !hasKey ? (
          <p className="text-meta text-fg-subtle">{t('ai.notConfigured')}</p>
        ) : null}

        {credential?.last_error ? (
          <p className="text-meta text-fg-muted">
            {t('ai.lastError', { error: credential.last_error })}
          </p>
        ) : null}
      </form>

      <div className="mt-4 border-t border-border pt-3">
        <h3 className="text-secondary font-medium text-fg">
          {t('ai.usageTitle')}
        </h3>

        {usageQuery.isPending ? (
          <div className="mt-1 flex items-center gap-2 text-meta text-fg-subtle">
            <Spinner size={12} />
            {t('common.loading')}
          </div>
        ) : usageQuery.isError || !usage ? (
          <p className="mt-1 text-meta text-fg-subtle">{t('ai.usageUnavailable')}</p>
        ) : (
          <div className="mt-1 flex flex-col gap-0.5 text-meta text-fg-muted tabular-nums">
            <span>
              {t('ai.usageToday')}
              {' · '}
              {t('ai.usageTokens', { total: usage.tokens_used_today })}
              {usage.daily_token_budget > 0 ? (
                <>
                  {' · '}
                  {t('ai.usageQuota', {
                    remaining: usage.quota_remaining,
                    budget: usage.daily_token_budget,
                  })}
                </>
              ) : null}
            </span>
            <span>
              {t('ai.usageRange', { days: usage.days })}
              {' · '}
              {usage.tokens.cached_tokens > 0
                ? t('ai.usageTokensCached', {
                    total: usage.tokens.total_tokens,
                    cached: usage.tokens.cached_tokens,
                  })
                : t('ai.usageTokens', { total: usage.tokens.total_tokens })}
            </span>
            <span>
              {t('ai.usageAiCalls', { ai: usage.ai_calls })}
              {' · '}
              {t('ai.usageCreated', { total: usage.created_tasks })}
            </span>
            {/* The local parser short-circuits in the browser (docs §8), so the
                server never sees those events. Saying so beats showing a
                permanent, misleading "0 local parses". */}
            <span className="text-fg-subtle">{t('ai.usageLocalHint')}</span>
          </div>
        )}
      </div>

      {hasKey ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-secondary font-medium text-fg">
              {t('ai.dangerTitle')}
            </p>
            <p className="text-meta text-fg-muted">{t('ai.dangerBody')}</p>
          </div>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('ai.deleteButton')}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t('ai.deleteConfirmTitle')}
        description={t('ai.deleteConfirmBody')}
        confirmLabel={t('ai.deleteButton')}
        confirmVariant="danger"
        loading={deleteCredential.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          deleteCredential.mutate(undefined, {
            onSuccess: () => {
              setDeleteOpen(false);
              setApiKey('');
              setTestResult(null);
              push({ type: 'success', message: t('ai.deleted') });
            },
            onError: (error) => {
              setDeleteOpen(false);
              push({ type: 'error', message: toApiError(error).detail });
            },
          });
        }}
      />
    </section>
  );
}
