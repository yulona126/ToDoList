/**
 * Lightweight Markdown → HTML for document preview.
 *
 * Escapes HTML first, then applies a GFM-ish subset used by developer plans:
 * headings, lists (incl. task lists), fenced/inline code, emphasis, links,
 * blockquotes, hr, paragraphs. No external dependency; output is safe to
 * inject via `dangerouslySetInnerHTML`.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Code spans first so emphasis does not touch their contents.
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

function flushParagraph(lines: string[], out: string[]): void {
  if (lines.length === 0) return;
  out.push(`<p>${inlineMarkdown(lines.join(' '))}</p>`);
  lines.length = 0;
}

/** Render Markdown source to an HTML string suitable for preview. */
export function renderMarkdown(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return '';

  const lines = normalized.split('\n');
  const out: string[] = [];
  const paragraph: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block
    if (/^```/.test(line)) {
      flushParagraph(paragraph, out);
      const lang = line.slice(3).trim();
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // closing fence
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      out.push(
        `<pre${langAttr}><code>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(paragraph, out);
      out.push('<hr />');
      i += 1;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph, out);
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph(paragraph, out);
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    // Unordered / task list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(paragraph, out);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
        const raw = (lines[i] ?? '').replace(/^\s*[-*+]\s+/, '');
        const task = /^\[([ xX])\]\s+(.*)$/.exec(raw);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            `<li class="task${checked ? ' checked' : ''}"><input type="checkbox" disabled${checked ? ' checked' : ''} /> ${inlineMarkdown(task[2])}</li>`,
          );
        } else {
          items.push(`<li>${inlineMarkdown(raw)}</li>`);
        }
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paragraph, out);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        const raw = (lines[i] ?? '').replace(/^\s*\d+\.\s+/, '');
        items.push(`<li>${inlineMarkdown(raw)}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      flushParagraph(paragraph, out);
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushParagraph(paragraph, out);
  return out.join('\n');
}

/** Title suggestion from a local filename (`v1-plan.md` → `v1-plan`). */
export function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  return base.replace(/\.(md|markdown|txt)$/i, '').trim();
}

/**
 * Read a local text/markdown file in the browser. Never uploads — only returns
 * the decoded string for the editor.
 */
export function readLocalMarkdownFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('empty'));
        return;
      }
      // Strip UTF-8 BOM if present.
      resolve(result.replace(/^\uFEFF/, ''));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file, 'UTF-8');
  });
}
