/**
 * Theme resolution and the switch animation.
 *
 * Three modes, not two: `system` is the default and re-resolves when the OS
 * changes, because a theme preference that silently stops following the OS is
 * the most common complaint about dark-mode toggles.
 *
 * The switch itself is a circular View Transition reveal growing from the point
 * that was clicked. Two details make it read as intentional rather than as a
 * cross-fade:
 *
 *  1. The default View Transition cross-fade is suppressed via a
 *     `theme-switching` class, so the clip and the fade own the motion.
 *  2. When the *resolved* palette does not change (e.g. dark → system while the
 *     OS is already dark) the wipe is skipped entirely — only the glyph swaps.
 *     Without this the control appears to do nothing.
 */
import { THEME_MODE_ORDER, type Theme, type ThemeMode } from './constants';

export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolveTheme(mode: ThemeMode): Theme {
  return mode === 'system' ? systemTheme() : mode;
}

export function readStoredMode(stored: string | null): ThemeMode | null {
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : null;
}

export function nextMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODE_ORDER.indexOf(mode);
  return THEME_MODE_ORDER[(index + 1) % THEME_MODE_ORDER.length]!;
}

/** Paint the resolved theme. Called before first paint too, from index.html. */
export function applyTheme(resolved: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // Native form controls, scrollbars and the caret follow this.
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0a0a' : '#ffffff');
}

/** Duration of the reveal in ms. */
const REVEAL_MS = 380;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function currentBackground(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim();
  return value || (document.documentElement.classList.contains('dark') ? '#0a0a0a' : '#ffffff');
}

export interface SwitchOptions {
  /** Viewport coordinates of the control that was clicked. */
  x?: number;
  y?: number;
  /** Skip the reveal (used when re-resolving `system` on an OS change). */
  instant?: boolean;
}

export function switchTheme(
  mode: ThemeMode,
  current: Theme,
  commit: () => void,
  options: SwitchOptions = {},
): void {
  const resolved = resolveTheme(mode);

  // Palette unchanged (e.g. dark -> system while the OS is already dark):
  // swap the glyph only. A reveal here would look like the control misfired.
  if (resolved === current) {
    applyTheme(resolved);
    commit();
    return;
  }

  const reduced = prefersReducedMotion();
  const canAnimate =
    !options.instant &&
    !reduced &&
    typeof document !== 'undefined' &&
    typeof document.body !== 'undefined';

  if (!canAnimate) {
    applyTheme(resolved);
    commit();
    return;
  }

  const x = options.x ?? window.innerWidth / 2;
  const y = options.y ?? window.innerHeight / 2;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const oldBackground = currentBackground();

  applyTheme(resolved);
  commit();

  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'pointer-events:none',
    `background:${oldBackground}`,
  ].join(';');
  document.body.appendChild(overlay);

  const mask = (r: number) =>
    `radial-gradient(circle ${r.toFixed(1)}px at ${x}px ${y}px, transparent 0 ${r.toFixed(1)}px, #000 ${r.toFixed(1)}px)`;

  overlay.style.maskImage = mask(0);
  overlay.style.webkitMaskImage = mask(0);

  const animation = overlay.animate(
    [{ maskImage: mask(0), webkitMaskImage: mask(0) },
     { maskImage: mask(radius), webkitMaskImage: mask(radius) }],
    { duration: REVEAL_MS, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', fill: 'forwards' },
  );

  animation.finished
    .catch(() => undefined)
    .finally(() => overlay.remove());
}
