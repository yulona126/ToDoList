import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { TaskPriority, TaskType } from './constants';

/**
 * Local rule parser — the front-end twin of `backend/apps/assistant/local_parser.py`
 * (docs/ai-assistant.md §2.2, T1).
 *
 * `写登录页 @开发 #api !高 明天` is fully structured, so it is resolved with
 * rules and never reaches the model: zero tokens, zero latency, works offline.
 * Only free-form prose escalates to AI, and only the caller decides that
 * (`shouldEscalate`).
 *
 * Tokenisation deliberately mirrors the Python parser (whitespace tokens, marker
 * prefixes only at the start of a token) so the instant preview cannot promise
 * something the server would resolve differently.
 *
 * The module is pure and dependency-free apart from dayjs, so it is trivially
 * testable: `today` is injected rather than read from the clock.
 */

export interface LocalDraft {
  /** Title — everything left after the markers are stripped. */
  t: string;
  /** Canonical name of a matched list, or `null` when nothing matched. */
  listName: string | null;
  tagNames: string[];
  priority: TaskPriority | null;
  taskType: TaskType | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
}

export interface LocalParseResult {
  drafts: LocalDraft[];
  /** Human-readable, already localised by the caller (see `unknownListLabel`). */
  warnings: string[];
  /**
   * `true` ⇒ this looks like prose the rules cannot segment, so the UI should
   * nudge the user towards "AI analyse".
   *
   * **Advisory only.** It never changes what gets created: whether a model is
   * used is entirely the user's choice (they either click the button or not).
   */
  shouldEscalate: boolean;
}

export interface LocalParseOptions {
  lists: readonly { id: number; name: string }[];
  /** Accepted for parity with the server parser, which also only needs names. */
  tags: readonly { id: number; name: string }[];
  /** `YYYY-MM-DD`, injected for testability. */
  today: string;
  /**
   * Localised "list not found" message. A `{name}` placeholder (single braces —
   * i18next only rewrites `{{…}}`, so this survives `t()` untouched) is
   * substituted when present, otherwise the name is appended.
   */
  unknownListLabel: string;
}

/* ------------------------------------------------------------------ grammar */

/** `!优先级` — Chinese / English / single-letter synonym table. */
const PRIORITY_SYNONYMS: Record<string, TaskPriority> = {
  低: 'low',
  low: 'low',
  l: 'low',
  中: 'medium',
  medium: 'medium',
  m: 'medium',
  普通: 'medium',
  高: 'high',
  high: 'high',
  h: 'high',
  紧急: 'urgent',
  急: 'urgent',
  urgent: 'urgent',
  u: 'urgent',
};

/** `/类型` — Chinese / English synonym table. */
const TYPE_SYNONYMS: Record<string, TaskType> = {
  开发: 'dev',
  dev: 'dev',
  会议: 'meeting',
  meeting: 'meeting',
  沟通: 'communication',
  communication: 'communication',
  设计: 'design',
  design: 'design',
  调研: 'research',
  research: 'research',
  其他: 'other',
  other: 'other',
};

/** Escalation triggers (docs/ai-assistant.md §2.2): likely several things at once. */
const CONNECTORS = ['和', '另外', '顺便', '还有', '以及', '并且', '同时'] as const;
const MAX_LOCAL_LINES = 2;
const MAX_LOCAL_LENGTH = 40;

/** dayjs `.day()` index (0 = Sunday). */
const WEEKDAY_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

const RELATIVE_DAYS: Record<string, number> = {
  今天: 0,
  今日: 0,
  today: 0,
  明天: 1,
  明日: 1,
  tomorrow: 1,
  后天: 2,
  大后天: 3,
};

const WEEKDAY_TOKEN = /^(下+)?(?:周|星期|礼拜)([一二三四五六日天])$/;
const SHORT_DATE_TOKEN = /^(\d{1,2})-(\d{1,2})$/;
const FULL_DATE_TOKEN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/* ------------------------------------------------------------------- helpers */

function mondayOfNextWeek(base: Dayjs): Dayjs {
  // dayjs weeks start on Sunday, so this week's Monday is +1 and next week's +8.
  return base.startOf('week').add(8, 'day');
}

function parseParts(
  year: number,
  month: number,
  dayOfMonth: number,
): Dayjs | null {
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const parsed = dayjs(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
      dayOfMonth,
    ).padStart(2, '0')}`,
  );
  return parsed.isValid() ? parsed : null;
}

/**
 * Resolve one whitespace-delimited token to a date, or `null`.
 *
 * `下周三` means "that weekday in the following week" (docs §2.1: with
 * `today = 2026-10-08`, `下周三` is `2026-10-14`), while `周三` means the next
 * occurrence including today.
 */
function resolveDate(token: string, base: Dayjs): Dayjs | null {
  const relative: number | undefined = RELATIVE_DAYS[token];
  if (relative !== undefined) return base.add(relative, 'day');

  const weekdayMatch = WEEKDAY_TOKEN.exec(token);
  if (weekdayMatch) {
    const prefix = weekdayMatch[1];
    const target: number | undefined = WEEKDAY_INDEX[weekdayMatch[2]];
    if (target === undefined) return null;
    const offset = (target + 6) % 7; // Monday = 0 … Sunday = 6
    if (prefix) {
      return mondayOfNextWeek(base)
        .add(7 * (prefix.length - 1), 'day')
        .add(offset, 'day');
    }
    // Next occurrence; today counts when the weekday is today.
    return base.add((target - base.day() + 7) % 7, 'day');
  }

  if (token === '下周' || token === '下个星期') {
    return mondayOfNextWeek(base);
  }

  const short = SHORT_DATE_TOKEN.exec(token);
  if (short) {
    // A bare `MM-DD` means the current year.
    return parseParts(base.year(), Number(short[1]), Number(short[2]));
  }

  const full = FULL_DATE_TOKEN.exec(token);
  if (full) {
    return parseParts(Number(full[1]), Number(full[2]), Number(full[3]));
  }

  return null;
}

function fillUnknownListLabel(label: string, name: string): string {
  return label.includes('{name}')
    ? label.replaceAll('{name}', name)
    : `${label} ${name}`;
}

function emptyDraft(title: string): LocalDraft {
  return {
    t: title,
    listName: null,
    tagNames: [],
    priority: null,
    taskType: null,
    dueDate: null,
  };
}

/* ------------------------------------------------------------------ parsing */

interface LineResult {
  draft: LocalDraft | null;
  warnings: string[];
}

function parseLine(
  raw: string,
  opts: LocalParseOptions,
  base: Dayjs,
): LineResult {
  const line = raw.trim();
  if (!line) return { draft: null, warnings: [] };

  // `^` wins outright: the whole rest of the line is the title, nothing else.
  if (line.startsWith('^')) {
    const title = line.slice(1).replace(/\s+/g, ' ').trim();
    return { draft: title ? emptyDraft(title) : null, warnings: [] };
  }

  const warnings: string[] = [];
  const titleParts: string[] = [];
  let listName: string | null = null;
  let priority: TaskPriority | null = null;
  let taskType: TaskType | null = null;
  let dueDate: string | null = null;
  const tagNames: string[] = [];

  for (const token of line.split(/\s+/)) {
    if (token.length > 1 && token.startsWith('@')) {
      const markerValue = token.slice(1);
      const canonical = opts.lists.find(
        (list) => list.name.toLowerCase() === markerValue.toLowerCase(),
      );
      if (canonical) {
        listName = canonical.name;
      } else {
        warnings.push(fillUnknownListLabel(opts.unknownListLabel, markerValue));
      }
      continue;
    }

    if (token.length > 1 && token.startsWith('#')) {
      // Known or not: the name is kept, and the server auto-creates unknown tags.
      const name = token.slice(1).trim();
      if (name && !tagNames.includes(name)) tagNames.push(name);
      continue;
    }

    if (token.length > 1 && token.startsWith('!')) {
      const value = PRIORITY_SYNONYMS[token.slice(1).toLowerCase()];
      if (value) priority = value;
      else titleParts.push(token); // not a priority after all — keep the words
      continue;
    }

    if (token.length > 1 && token.startsWith('/')) {
      const value = TYPE_SYNONYMS[token.slice(1).toLowerCase()];
      if (value) taskType = value;
      else titleParts.push(token);
      continue;
    }

    if (dueDate === null) {
      const resolved = resolveDate(token, base);
      if (resolved) {
        dueDate = resolved.format('YYYY-MM-DD');
        continue;
      }
    }

    titleParts.push(token);
  }

  const title = titleParts.join(' ').trim();
  if (!title) return { draft: null, warnings };

  return {
    draft: { t: title, listName, tagNames, priority, taskType, dueDate },
    warnings,
  };
}

/**
 * Parse a (possibly multi-line) blob into draft tasks.
 *
 * Every non-empty line is parsed independently. `shouldEscalate` is decided once
 * for the whole input, and a `^` at the very start suppresses it (the user said
 * "this is all one title").
 */
export function localParse(text: string, opts: LocalParseOptions): LocalParseResult {
  const base = dayjs(opts.today);
  const trimmed = text.trim();
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const drafts: LocalDraft[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const result = parseLine(line, opts, base);
    if (result.draft) drafts.push(result.draft);
    warnings.push(...result.warnings);
  }

  const forced = trimmed.startsWith('^');
  const shouldEscalate =
    trimmed.length > 0 &&
    !forced &&
    (CONNECTORS.some((connector) => trimmed.includes(connector)) ||
      lines.length > MAX_LOCAL_LINES ||
      trimmed.length > MAX_LOCAL_LENGTH);

  return { drafts, warnings, shouldEscalate };
}
