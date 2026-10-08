import { useEffect, useState } from 'react';

/**
 * Debounce a fast-changing value (used for the search box so typing does not
 * fire one request per keystroke). The URL itself still updates immediately, so
 * every search input on screen stays in sync.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
