import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createApiToken,
  fetchApiTokens,
  revokeApiToken,
} from '../lib/tokensApi';
import type {
  ApiTokenCreatePayload,
  ApiTokenCreateResult,
  ApiTokenListResult,
  ID,
} from '../types';
import { queryKeys } from './queryKeys';

/**
 * React Query bindings for the API token endpoints (api.md §1).
 *
 * The list is a plain server-cached collection: create/revoke both invalidate
 * it, because the server decides `is_active` / `last_used_at` and the client
 * must not guess them (a revoked row stays visible for audit).
 *
 * Secrets: `GET /auth/tokens/` never returns plaintext, so the list cache is
 * safe. The create response *does* contain the secret, which is why the
 * mutation sets `gcTime: 0` — the value is read once by the caller and must not
 * linger in the mutation cache after the reveal modal closes.
 */

/** `GET /auth/tokens/` — metadata only, never plaintext. */
export function useApiTokens() {
  return useQuery<ApiTokenListResult>({
    queryKey: queryKeys.tokens.list,
    queryFn: fetchApiTokens,
    staleTime: 30_000,
  });
}

/** `POST /auth/tokens/` — returns the one-time plaintext `token`. */
export function useCreateApiToken() {
  const client = useQueryClient();
  return useMutation<ApiTokenCreateResult, unknown, ApiTokenCreatePayload>({
    mutationFn: createApiToken,
    gcTime: 0,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tokens.all });
    },
  });
}

/** `DELETE /auth/tokens/{id}/` — revokes, keeps the row for audit. */
export function useRevokeApiToken() {
  const client = useQueryClient();
  return useMutation<void, unknown, ID>({
    mutationFn: revokeApiToken,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tokens.all });
    },
  });
}
