/**
 * Tiny event bus for "focus the search box".
 *
 * There can be more than one search input on screen — the Topbar one (≥640px)
 * and the compact one in the filter bar (<640px). Each registers a handler that
 * returns `true` only when it actually focused a *visible* element, so `/` lands
 * on whichever input the current breakpoint is showing.
 */
export type SearchFocusHandler = () => boolean;

const handlers = new Set<SearchFocusHandler>();

/** Returns the unregister function (convenient as an effect cleanup). */
export function registerSearchFocusHandler(
  handler: SearchFocusHandler,
): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function focusSearch(): void {
  for (const handler of handlers) {
    if (handler()) return;
  }
}

/** Focus `element` if it is actually rendered (not `display: none`). */
export function focusIfVisible(element: HTMLElement | null): boolean {
  if (!element || element.offsetParent === null) return false;
  element.focus();
  return true;
}
