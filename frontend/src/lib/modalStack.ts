/**
 * Modal ownership counter.
 *
 * Global keyboard shortcuts (`N`, `/`) must stay silent while a dialog owns the
 * focus, and a DOM query for `[role="dialog"]` would be a fragile proxy. The
 * Modal component increments this counter on open and decrements on close.
 */
let openModals = 0;

export function pushModal(): void {
  openModals += 1;
}

export function popModal(): void {
  openModals = Math.max(0, openModals - 1);
}

export function hasOpenModal(): boolean {
  return openModals > 0;
}
