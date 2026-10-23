import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { translate } from '../i18n';
import type { TokenPair } from '../types';
import { STORAGE_KEYS } from './constants';

/* ------------------------------------------------------------------ tokens */

/**
 * Token strategy (docs/architecture.md §6.1):
 *  - `access` lives in a module-level variable only — never in localStorage,
 *    so an XSS payload cannot read it off disk;
 *  - `refresh` lives in localStorage so a page reload can restore the session.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.refresh);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEYS.refresh, token);
    else window.localStorage.removeItem(STORAGE_KEYS.refresh);
  } catch {
    /* localStorage can be unavailable (private mode) — session stays in memory */
  }
}

export function clearTokens(): void {
  accessToken = null;
  setRefreshToken(null);
}

/* ------------------------------------------------------- error shape (0.2) */

export interface ApiError {
  detail: string;
  errors?: Record<string, string[]>;
  status?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrow `{"title": ["required"]}` without ever reaching for `any`. */
function asFieldErrors(value: unknown): Record<string, string[]> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Record<string, string[]> = {};
  let found = false;
  for (const [key, raw] of Object.entries(record)) {
    if (Array.isArray(raw)) {
      const messages = raw.filter(
        (item): item is string => typeof item === 'string',
      );
      if (messages.length > 0) {
        result[key] = messages;
        found = true;
      }
    } else if (typeof raw === 'string') {
      result[key] = [raw];
      found = true;
    }
  }
  return found ? result : undefined;
}

/**
 * Normalise anything thrown by axios/JS into the contract's error shape
 * (docs/api.md §0.2) with a localised, always-present `detail`.
 */
export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = asRecord(error.response?.data);

    if (!error.response) {
      return { detail: translate('errors.network') };
    }

    if (body) {
      const detail = typeof body.detail === 'string' ? body.detail : undefined;
      const errors = asFieldErrors(body.errors);
      if (detail || errors) {
        return {
          detail: detail ?? errorsFallback(status),
          errors,
          status,
        };
      }
      const nonField = asFieldErrors(body);
      if (nonField) {
        return { detail: errorsFallback(status), errors: nonField, status };
      }
    }

    return { detail: errorsFallback(status), status };
  }

  if (error instanceof Error && error.message) {
    return { detail: error.message };
  }
  return { detail: translate('errors.unknown') };
}

function errorsFallback(status: number | undefined): string {
  switch (status) {
    case 400:
      return translate('errors.validation');
    case 401:
      return translate('errors.unauthorized');
    case 403:
      return translate('errors.forbidden');
    case 404:
      return translate('errors.notFound');
    case 429:
      return translate('errors.rateLimited');
    case 500:
    case 502:
    case 503:
    case 504:
      return translate('errors.server');
    default:
      return translate('errors.generic');
  }
}

/** Pull a single field's first message out of a normalised error. */
export function fieldError(
  error: ApiError | undefined,
  field: string,
): string | undefined {
  const messages = error?.errors?.[field];
  return messages && messages.length > 0 ? messages[0] : undefined;
}

/* ----------------------------------------------------------- axios clients */

/** The authenticated client used by every hook. */
export const api: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

/**
 * A bare client for `/auth/refresh/` so a failing refresh can never re-enter the
 * 401 interceptor (which would loop).
 */
const refreshClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  /** Set once we already replayed this request after a refresh. */
  _retry?: boolean;
  /** Opt out of the silent-refresh dance entirely. */
  _skipAuthRefresh?: boolean;
}

/* -------------------------------------------------------------- 401 handler */

let unauthorizedHandler: (() => void) | null = null;

/** AuthContext registers the "session is gone" behaviour (clear state + /login). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  clearTokens();
  unauthorizedHandler?.();
}

/* ------------------------------------------------------- refresh (single-flight) */

let refreshPromise: Promise<string> | null = null;

async function performRefresh(refresh: string): Promise<string> {
  const response = await refreshClient.post<TokenPair>('/auth/refresh/', {
    refresh,
  });
  const { access, refresh: rotated } = response.data;
  setAccessToken(access);
  // simplejwt rotates refresh tokens; keep the newest one.
  if (rotated) setRefreshToken(rotated);
  return access;
}

/**
 * Exactly one in-flight refresh for N concurrent 401s: every caller awaits the
 * same promise, so the server sees a single `POST /auth/refresh/`.
 */
function runRefresh(refresh: string): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh(refresh).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Exchange the stored refresh token for a fresh access token. */
export function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) {
    return Promise.reject(new Error(translate('errors.unauthorized')));
  }
  return runRefresh(refresh);
}

/* ----------------------------------------------------------- interceptors */

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  // Default Content-Type is application/json. For FormData uploads the browser
  // must set multipart/form-data *with* a boundary — otherwise Django sees an
  // empty FILES dict and returns 400.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

const AUTH_ENDPOINTS_WITHOUT_REFRESH = [
  '/auth/refresh/',
  '/auth/login/',
  '/auth/register/',
];

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown): Promise<never | AxiosResponse> => {
    if (!axios.isAxiosError(error)) {
      throw error;
    }

    const config = error.config as RetryableRequestConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';

    if (
      !config ||
      status !== 401 ||
      config._retry ||
      config._skipAuthRefresh ||
      AUTH_ENDPOINTS_WITHOUT_REFRESH.some((endpoint) => url.includes(endpoint))
    ) {
      throw error;
    }

    const refresh = getRefreshToken();
    if (!refresh) {
      handleUnauthorized();
      throw error;
    }

    config._retry = true;
    try {
      const token = await runRefresh(refresh);
      config.headers.set('Authorization', `Bearer ${token}`);
      // Replay the original request exactly once.
      return await api.request(config);
    } catch (refreshError) {
      handleUnauthorized();
      throw refreshError;
    }
  },
);

export default api;
