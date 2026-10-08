import type {
  AiCredential,
  AiCredentialTestResult,
  AiCredentialUpdate,
  AiDraft,
  AiParseRequest,
  AiParseResponse,
  AiSplitResponse,
  AiUsage,
  AiUsageSummary,
  AiWarning,
  BulkCreatePayload,
  BulkCreateResult,
} from '../types';
import type { TaskPriority, TaskType } from './constants';
import { api } from './api';

/**
 * Thin I/O + wire-shape translation for docs/ai-assistant.md §5.
 *
 * The backend echoes the model's compact JSON keys (`t/l/l_name/p/y/d/g/g_names/s`,
 * T3 in §2) because that is what the model actually produced. Components must not
 * see them, so everything is translated to camelCase here — the one place that
 * knows the wire format.
 *
 * Only the response type is imported from `types/`; the axios instance and the
 * error envelope stay untouched (`toApiError` is applied by the hooks/callers).
 */

/* ------------------------------------------------------------ wire → UI shape */

/** A draft in the shape the UI works with (never the short wire keys). */
export interface ParsedDraft {
  title: string;
  listId: number | null;
  listName: string | null;
  priority: TaskPriority | null;
  taskType: TaskType | null;
  dueDate: string | null;
  tagIds: number[];
  tagNames: string[];
  subtasks: string[];
}

export interface ParsedTextResult {
  /** `local` means the rule parser answered and nothing was billed. */
  source: 'local' | 'ai';
  drafts: ParsedDraft[];
  warnings: AiWarning[];
  usage: AiUsage | null;
  latencyMs: number;
}

export interface ParsedSplitResult {
  subtasks: string[];
  usage: AiUsage | null;
}

function asArray<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.slice() : [];
}

export function toParsedDraft(draft: AiDraft): ParsedDraft {
  return {
    title: draft.t ?? '',
    listId: draft.l ?? null,
    listName: draft.l_name ?? null,
    priority: draft.p ?? null,
    taskType: draft.y ?? null,
    dueDate: draft.d ?? null,
    tagIds: asArray(draft.g),
    tagNames: asArray(draft.g_names),
    subtasks: asArray(draft.s),
  };
}

export function toParsedTextResult(
  response: AiParseResponse,
): ParsedTextResult {
  return {
    source: response.source === 'ai' ? 'ai' : 'local',
    drafts: asArray(response.tasks).map(toParsedDraft),
    warnings: asArray(response.warnings),
    usage: response.usage ?? null,
    latencyMs: response.latency_ms ?? 0,
  };
}

/* ------------------------------------------------------------------- requests */

/** `GET /ai/credential/` — masked only, never the plaintext key. */
export async function fetchAiCredential(): Promise<AiCredential> {
  const { data } = await api.get<AiCredential>('/ai/credential/');
  return data;
}

/** `PUT /ai/credential/` — an empty `api_key` keeps the stored one. */
export async function saveAiCredential(
  payload: AiCredentialUpdate,
): Promise<AiCredential> {
  const { data } = await api.put<AiCredential>('/ai/credential/', payload);
  return data;
}

/** `DELETE /ai/credential/` */
export async function deleteAiCredential(): Promise<void> {
  await api.delete('/ai/credential/');
}

/** `POST /ai/credential/test/` — a one-token probe against the upstream API. */
export async function testAiCredential(): Promise<AiCredentialTestResult> {
  const { data } = await api.post<AiCredentialTestResult>(
    '/ai/credential/test/',
  );
  return data;
}

/** `POST /ai/parse/` */
export async function parseText(
  payload: AiParseRequest,
): Promise<ParsedTextResult> {
  const { data } = await api.post<AiParseResponse>('/ai/parse/', payload);
  return toParsedTextResult(data);
}

/** `POST /ai/split/` — 3–5 sub-tasks for one existing task. */
export async function splitTask(taskId: number): Promise<ParsedSplitResult> {
  const { data } = await api.post<AiSplitResponse>('/ai/split/', {
    task_id: taskId,
  });
  return {
    subtasks: asArray(data.subtasks).map((item) => item.t),
    usage: data.usage ?? null,
  };
}

/** `GET /ai/usage/?days=30` */
export async function fetchAiUsage(days: number): Promise<AiUsageSummary> {
  const { data } = await api.get<AiUsageSummary>('/ai/usage/', {
    params: { days },
  });
  return data;
}

/** `POST /tasks/bulk-create/` — one transaction, all-or-nothing (api spec §5). */
export async function bulkCreateTasks(
  payload: BulkCreatePayload,
): Promise<BulkCreateResult> {
  const { data } = await api.post<BulkCreateResult>(
    '/tasks/bulk-create/',
    payload,
  );
  return data;
}
