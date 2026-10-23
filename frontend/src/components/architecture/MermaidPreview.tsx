import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatMermaidError,
  normalizeMermaidSource,
} from '../../lib/mermaidNormalize';
import { cn } from '../../lib/utils';
import { Spinner } from '../ui/Spinner';

export interface MermaidPreviewProps {
  source: string;
  className?: string;
  /** Fired after a successful render so the parent viewport can re-fit. */
  onRendered?: (info: { normalized: boolean }) => void;
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

let mermaidLoader: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      const api = mod.default as MermaidApi;
      api.initialize({
        startOnLoad: false,
        // loose: allow <br/> in labels; still no script execution.
        securityLevel: 'loose',
        theme: document.documentElement.classList.contains('dark')
          ? 'dark'
          : 'neutral',
        fontFamily: 'inherit',
        flowchart: { htmlLabels: true, curve: 'basis' },
      });
      return api;
    });
  }
  return mermaidLoader;
}

/**
 * Renders Mermaid source to SVG. Loads the library on demand so the task board
 * bundle does not pay for it until the architecture page is opened.
 */
export function MermaidPreview({
  source,
  className,
  onRendered,
}: MermaidPreviewProps) {
  const { t } = useTranslation();
  const reactId = useId().replace(/:/g, '');
  const seqRef = useRef(0);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [usedNormalize, setUsedNormalize] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trimmed = source.trim();
    if (!trimmed) {
      setSvg('');
      setError(null);
      setPending(false);
      setUsedNormalize(false);
      return;
    }

    const seq = ++seqRef.current;
    setPending(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const api = await loadMermaid();
          const normalized = normalizeMermaidSource(trimmed);
          const id = `mmd-${reactId}-${seq}`;
          const result = await api.render(id, normalized);
          // Remove orphaned helper nodes mermaid may leave in <body>.
          document.getElementById(id)?.remove();
          if (cancelled || seq !== seqRef.current) return;
          setSvg(result.svg);
          setError(null);
          const normalizedUsed = normalized !== trimmed;
          setUsedNormalize(normalizedUsed);
          onRenderedRef.current?.({ normalized: normalizedUsed });
        } catch (err) {
          if (cancelled || seq !== seqRef.current) return;
          setSvg('');
          setError(formatMermaidError(err));
          setUsedNormalize(false);
        } finally {
          if (!cancelled && seq === seqRef.current) setPending(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, reactId]);

  if (!source.trim()) {
    return (
      <p className={cn('text-secondary text-fg-subtle', className)}>
        {t('architecture.mermaidEmpty')}
      </p>
    );
  }

  if (pending && !svg) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 text-meta text-fg-subtle',
          className,
        )}
        role="status"
      >
        <Spinner size={14} />
        {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col gap-1 p-4', className)} role="alert">
        <p className="text-secondary text-fg-muted">
          {t('architecture.renderError')}: {error}
        </p>
        <p className="text-meta text-fg-subtle">{t('architecture.renderHint')}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mermaid-diagram select-none [&_svg]:block [&_svg]:max-w-none',
        className,
      )}
      data-normalized={usedNormalize ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
