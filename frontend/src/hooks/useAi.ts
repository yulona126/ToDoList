import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bulkCreateTasks,
  deleteAiCredential,
  fetchAiCredential,
  fetchAiUsage,
  parseText,
  saveAiCredential,
  splitTask,
  testAiCredential,
  type ParsedSplitResult,
  type ParsedTextResult,
} from '../lib/aiApi';
import type {
  AiCredential,
  AiCredentialTestResult,
  AiCredentialUpdate,
  AiParseRequest,
  BulkCreatePayload,
  BulkCreateResult,
} from '../types';
import { queryKeys } from './queryKeys';
import { invalidateStats, invalidateTasks } from './taskCache';

/**
 * React Query bindings for the AI assistant (docs/ai-assistant.md §5).
 *
 * The network/mapping half lives in `lib/aiApi.ts`; these hooks only own caching,
 * invalidation and the mutation lifecycle. Every response is already in the
 * camelCase UI shape — no component ever sees the model's short keys.
 */

/* --------------------------------------------------------------- credential */

/** `GET /ai/credential/` — the masked view of the stored key. */
export function useAiCredential(enabled = true) {
  return useQuery({
    queryKey: queryKeys.ai.credential,
    enabled,
    queryFn: fetchAiCredential,
    staleTime: 30_000,
  });
}

export function useUpdateAiCredential() {
  const client = useQueryClient();
  return useMutation<AiCredential, unknown, AiCredentialUpdate>({
    mutationFn: saveAiCredential,
    onSuccess: (credential) => {
      client.setQueryData(queryKeys.ai.credential, credential);
      void client.invalidateQueries({ queryKey: queryKeys.ai.usagePrefix });
    },
  });
}

export function useDeleteAiCredential() {
  const client = useQueryClient();
  return useMutation<void, unknown, void>({
    mutationFn: deleteAiCredential,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.ai.credential });
      void client.invalidateQueries({ queryKey: queryKeys.ai.usagePrefix });
    },
  });
}

/** `POST /ai/credential/test/` — a `max_tokens=1` liveness probe. */
export function useTestAiCredential() {
  const client = useQueryClient();
  return useMutation<AiCredentialTestResult, unknown, void>({
    mutationFn: testAiCredential,
    onSettled: () => {
      // The probe writes `last_verified_at` / `last_error` and records usage.
      void client.invalidateQueries({ queryKey: queryKeys.ai.credential });
      void client.invalidateQueries({ queryKey: queryKeys.ai.usagePrefix });
    },
  });
}

/* -------------------------------------------------------------------- parse */

/** `POST /ai/parse/` — text in, reviewable drafts out. Nothing is persisted. */
export function useAiParse() {
  const client = useQueryClient();
  return useMutation<ParsedTextResult, unknown, AiParseRequest>({
    mutationFn: parseText,
    onSuccess: (result) => {
      // A successful AI call was billed, so today's counter moved.
      if (result.source === 'ai') {
        void client.invalidateQueries({ queryKey: queryKeys.ai.usagePrefix });
      }
    },
  });
}

/** `POST /ai/split/` — 3–5 sub-tasks for one existing task. */
export function useAiSplitTask() {
  const client = useQueryClient();
  return useMutation<ParsedSplitResult, unknown, number>({
    mutationFn: splitTask,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.ai.usagePrefix });
    },
  });
}

/* -------------------------------------------------------------------- usage */

/** `GET /ai/usage/?days=30` — today + the window + the latest audit rows. */
export function useAiUsage(days = 30, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ai.usage(days),
    enabled,
    queryFn: () => fetchAiUsage(days),
    staleTime: 30_000,
  });
}

/* ----------------------------------------------------------- bulk creation */

/**
 * `POST /tasks/bulk-create/` — the single write at the end of the capture flow
 * (api.md §5). It is not AI-specific, but it is only ever reached from the draft
 * confirmation panel today, so it lives next to the AI hooks.
 *
 * Everything the board renders — the task list, the workspace counters and the
 * per-list stats — depends on it, so all three families are invalidated.
 */
export function useBulkCreateTasks() {
  const client = useQueryClient();
  return useMutation<BulkCreateResult, unknown, BulkCreatePayload>({
    mutationFn: bulkCreateTasks,
    onSuccess: (result) => {
      for (const task of result.tasks) {
        client.setQueryData(queryKeys.tasks.detail(task.id), task);
      }
      invalidateTasks(client);
      invalidateStats(client);
    },
  });
}
