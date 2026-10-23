import { useMemo } from 'react';
import { renderMarkdown } from '../../lib/markdown';
import { cn } from '../../lib/utils';

export interface MarkdownPreviewProps {
  source: string;
  emptyLabel?: string;
  className?: string;
}

/** Renders Markdown as styled HTML (token-based `.md-preview` styles). */
export function MarkdownPreview({
  source,
  emptyLabel,
  className,
}: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(source), [source]);

  if (!source.trim()) {
    return (
      <p className={cn('text-secondary text-fg-subtle', className)}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <div
      className={cn('md-preview', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
