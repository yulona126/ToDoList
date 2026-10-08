import { QueryClient } from '@tanstack/react-query';
import { toApiError } from './api';

/**
 * Single QueryClient for the app.
 *
 * `retry` is deliberately status-aware: retrying a 400/404 just burns requests,
 * while a 5xx or a network blip is worth two more attempts.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const { status } = toApiError(error);
        if (typeof status === 'number' && status >= 400 && status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});
