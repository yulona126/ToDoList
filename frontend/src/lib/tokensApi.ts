import type {
  ApiTokenCreatePayload,
  ApiTokenCreateResult,
  ApiTokenListResult,
} from '../types';
import { api } from './api';

/**
 * I/O for the personal access token endpoints (api.md §1,
 * "API Tokens `/auth/tokens`").
 *
 * Kept separate from `aiApi.ts` (which is AI-specific): these three calls are
 * plain CRUD over the shared authenticated axios instance. Two rules matter:
 *
 *  - the list call never sees plaintext — only a `prefix` — so nothing here can
 *    accidentally cache a secret;
 *  - `createApiToken` is the single place where a plaintext `tdl_…` crosses the
 *    wire, and the caller is responsible for holding it in memory only.
 */

/** `GET /auth/tokens/` */
export async function fetchApiTokens(): Promise<ApiTokenListResult> {
  const { data } = await api.get<ApiTokenListResult>('/auth/tokens/');
  return data;
}

/** `POST /auth/tokens/` — 201 with the one-time plaintext `token`. */
export async function createApiToken(
  payload: ApiTokenCreatePayload,
): Promise<ApiTokenCreateResult> {
  const { data } = await api.post<ApiTokenCreateResult>(
    '/auth/tokens/',
    payload,
  );
  return data;
}

/** `DELETE /auth/tokens/{id}/` — 204; the server keeps the row for audit. */
export async function revokeApiToken(id: number): Promise<void> {
  await api.delete(`/auth/tokens/${id}/`);
}
