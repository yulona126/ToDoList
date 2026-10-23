/**
 * Mermaid flowchart labels break easily on `/`, `?`, `*`, `+`, literal `\n`,
 * and ASCII `...` (lexer confuses it with dotted edges). Normalize for
 * preview/render without requiring the user to rewrite every node by hand.
 */

const SPECIAL_IN_LABEL = /[/\\?*+=#<>()[\]{}]|<br\s*\/?>/i;

/** Turn literal `\n` (two chars) into Mermaid line breaks. */
function unescapeNewlines(text: string): string {
  return text.replace(/\\n/g, '<br>');
}

/**
 * Mermaid's flowchart lexer treats `...` near links/shapes specially and can
 * end a node early, then choke on the closing quote (`got 'NODE_STRING'`).
 * Unicode ellipsis is safe inside labels.
 */
function sanitizeLabelText(text: string): string {
  return unescapeNewlines(text)
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/\.{2,}/g, '…');
}

function quoteSquare(id: string, label: string): string {
  return `${id}["${sanitizeLabelText(label).replace(/"/g, "'")}"]`;
}

function quoteRound(id: string, label: string): string {
  return `${id}("${sanitizeLabelText(label).replace(/"/g, "'")}")`;
}

/**
 * Wrap unquoted `id[label]` / `id(label)` when the label has characters that
 * confuse the parser. Already-quoted labels are still sanitized (`\n`, `...`).
 *
 * Also turns leftover literal `\n` between statements into real newlines —
 * common when Mermaid is pasted with escaped newlines.
 */
export function normalizeMermaidSource(source: string): string {
  let text = source.replace(/\r\n?/g, '\n');

  // Quoted labels: always sanitize contents.
  text = text.replace(
    /(\b[\w.-]+)\[\s*"([^"]*)"\s*\]/g,
    (_m, id: string, label: string) => quoteSquare(id, label),
  );
  text = text.replace(
    /(\b[\w.-]+)\(\s*"([^"]*)"\s*\)/g,
    (_m, id: string, label: string) => quoteRound(id, label),
  );

  // Unquoted square labels. Skip `subgraph id [Title]` — different grammar.
  text = text.replace(
    /(?<!subgraph\s)(\b[\w.-]+)\[\s*([^\]"]*?)\s*\]/g,
    (_m, id: string, label: string) => {
      const fixed = sanitizeLabelText(label);
      if (
        SPECIAL_IN_LABEL.test(fixed) ||
        fixed.includes('<br>') ||
        fixed.includes('…')
      ) {
        return quoteSquare(id, fixed);
      }
      return `${id}[${fixed}]`;
    },
  );

  text = text.replace(
    /(\b[\w.-]+)\(\s*([^)"]*?)\s*\)/g,
    (_m, id: string, label: string) => {
      const fixed = sanitizeLabelText(label);
      if (
        SPECIAL_IN_LABEL.test(fixed) ||
        fixed.includes('<br>') ||
        fixed.includes('…')
      ) {
        return quoteRound(id, fixed);
      }
      return `${id}(${fixed})`;
    },
  );

  // After labels absorbed their `\n` → `<br>`, any leftover literal `\n` is a
  // statement separator that was stored escaped (e.g. `]\n    nextNode`).
  text = text.replace(/\\n/g, '\n');

  return text;
}

export function formatMermaidError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.str === 'string') return record.str;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.hash === 'object' && record.hash) {
      const hash = record.hash as Record<string, unknown>;
      if (typeof hash.text === 'string') return hash.text;
    }
  }
  return 'unknown parse error';
}
