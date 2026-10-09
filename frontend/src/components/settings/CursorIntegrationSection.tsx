import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUI } from '../../stores/UIContext';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

const MCP_ZIP = '/downloads/todolist-cursor-mcp.zip';
const SKILL_ZIP = '/downloads/todolist-cursor-skill.zip';
const MANIFEST_URL = '/downloads/manifest.json';

type Manifest = {
  version?: string;
  built_at?: string;
  packages?: {
    mcp?: { file: string; bytes: number };
    skill?: { file: string; bytes: number };
  };
};

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8081/api/v1';
  return `${window.location.origin}/api/v1`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** Trigger a file download without navigating the SPA (SW would show 404). */
function downloadFile(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Settings → Cursor MCP / Skill downloads + install tutorial.
 *
 * Packages are static files under /downloads/ (built by
 * scripts/pack-cursor-integration.sh). The suggested API URL follows the
 * current page origin so LAN / Tunnel users get a reachable address.
 */
export function CursorIntegrationSection() {
  const { t } = useTranslation();
  const { push } = useUI();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const apiUrl = useMemo(() => detectApiUrl(), []);

  useEffect(() => {
    let cancelled = false;
    void fetch(MANIFEST_URL, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Manifest | null) => {
        if (!cancelled && data) setManifest(data);
      })
      .catch(() => {
        /* offline / missing pack — downloads may still work */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCopy = useCallback(
    async (value: string, successKey: string) => {
      const ok = await copyText(value);
      push({
        type: ok ? 'success' : 'error',
        message: ok ? t(successKey) : t('cursor.copyFailed'),
      });
    },
    [push, t],
  );

  const installCmd = t('cursor.installCmd', { apiUrl });
  const tokenCmd = t('cursor.tokenCmd');

  const mcpSize = formatBytes(manifest?.packages?.mcp?.bytes);
  const skillSize = formatBytes(manifest?.packages?.skill?.bytes);

  return (
    <section
      id="cursor-integration"
      className="rounded-card border border-border bg-surface p-4"
    >
      <h2 className="text-card-title font-semibold text-fg">
        {t('cursor.settingsTitle')}
      </h2>
      <p className="mt-0.5 mb-3 text-secondary text-fg-muted">
        {t('cursor.settingsDescription')}
      </p>

      <div className="mb-4 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-meta text-fg-muted">{t('cursor.apiUrlLabel')}</p>
            <code className="mt-0.5 block break-all text-secondary text-fg">
              {apiUrl}
            </code>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void onCopy(apiUrl, 'cursor.apiUrlCopied')}
          >
            {t('cursor.copy')}
          </Button>
        </div>
        <p className="mt-1.5 text-meta text-fg-muted">{t('cursor.apiUrlHint')}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          iconLeft={<Icon name="download" size={14} />}
          onClick={() => downloadFile(MCP_ZIP, 'todolist-cursor-mcp.zip')}
        >
          {t('cursor.downloadMcp')}
          {mcpSize ? ` (${mcpSize})` : ''}
        </Button>
        <Button
          type="button"
          variant="secondary"
          iconLeft={<Icon name="download" size={14} />}
          onClick={() => downloadFile(SKILL_ZIP, 'todolist-cursor-skill.zip')}
        >
          {t('cursor.downloadSkill')}
          {skillSize ? ` (${skillSize})` : ''}
        </Button>
      </div>

      {manifest?.version ? (
        <p className="mb-4 text-meta text-fg-subtle">
          {t('cursor.packageVersion', { version: manifest.version })}
        </p>
      ) : null}

      <ol className="flex flex-col gap-4">
        <Step n={1} title={t('cursor.step1Title')}>
          <p className="text-secondary text-fg-muted">{t('cursor.step1Body')}</p>
          <p className="mt-1 text-secondary text-fg-muted">
            {t('cursor.step1TokenHint')}{' '}
            <a href="#api-tokens" className="text-fg underline underline-offset-2">
              {t('cursor.step1TokenLink')}
            </a>
            {t('cursor.step1TokenSuffix')}
          </p>
        </Step>

        <Step n={2} title={t('cursor.step2Title')}>
          <p className="mb-2 text-secondary text-fg-muted">{t('cursor.step2Body')}</p>
          <CodeBlock
            value={installCmd}
            onCopy={() => void onCopy(installCmd, 'cursor.copied')}
            copyLabel={t('cursor.copy')}
          />
        </Step>

        <Step n={3} title={t('cursor.step3Title')}>
          <p className="mb-2 text-secondary text-fg-muted">{t('cursor.step3Body')}</p>
          <CodeBlock
            value={tokenCmd}
            onCopy={() => void onCopy(tokenCmd, 'cursor.copied')}
            copyLabel={t('cursor.copy')}
          />
        </Step>

        <Step n={4} title={t('cursor.step4Title')}>
          <p className="text-secondary text-fg-muted">{t('cursor.step4Body')}</p>
        </Step>
      </ol>

      <p className="mt-4 text-meta text-fg-muted">{t('cursor.footnote')}</p>
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="list-none">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-meta text-fg">
          {n}
        </span>
        <h3 className="text-secondary font-medium text-fg">{title}</h3>
      </div>
      <div className="pl-7">{children}</div>
    </li>
  );
}

function CodeBlock({
  value,
  onCopy,
  copyLabel,
}: {
  value: string;
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div className="relative rounded-lg border border-border bg-bg">
      <pre className="overflow-x-auto p-3 pr-16 text-meta leading-relaxed text-fg whitespace-pre-wrap break-all">
        {value}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        onClick={onCopy}
      >
        {copyLabel}
      </Button>
    </div>
  );
}
