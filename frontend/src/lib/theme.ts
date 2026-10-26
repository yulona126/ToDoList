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

/** Duration of the reveal. Long enough to read, short enough to stay out of the way. */
const REVEAL_MS = 900;
/** Steady expansion with a soft landing — clearer than linear, less abrupt than expo. */
const REVEAL_EASING = 'cubic-bezier(0.33, 0, 0.2, 1)';

/**
 * True while a reveal is running.
 *
 * During a View Transition the snapshot layer sits above the page, so a click
 * that lands mid-animation is delivered to that layer instead of the control
 * that was clicked. The event still reaches `window` in the capture phase, so
 * `ThemeToggle` uses this flag to spot and honour those clicks (see
 * docs/theme-switching.md and the note in that component).
 */
let switching = false;

export function isThemeSwitching(): boolean {
  return switching;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface SwitchOptions {
  /** Viewport coordinates of the control that was clicked. */
  x?: number;
  y?: number;
  /** Skip the reveal (used when re-resolving `system` on an OS change). */
  instant?: boolean;
}

/**
 * Circular reveal via the View Transitions API (docs/theme-switching.md §4).
 *
 * The callback handed to `startViewTransition` swaps the theme synchronously;
 * the browser snapshots before and after, then gives those two screenshots back
 * so a `clip-path` circle can grow from the click point over the new one while
 * the old one dims to 0.72. The page is handed over in one go, which is why no
 * element is ever seen half-themed.
 *
 * Coordinates are `clientX/clientY` — the same space `circle(... at X Y)` uses.
 * `pageX/pageY` would include scroll offset and put the origin off-screen.
 *
 * When the browser has no View Transitions, or the reader asked for reduced
 * motion, this degrades to an instant swap. Fully functional, just unanimated.
 */
export function switchTheme(
  mode: ThemeMode,
  current: Theme,
  commit: () => void,
  options: SwitchOptions = {},
): void {
  const resolved = resolveTheme(mode);

  // Palette unchanged (e.g. dark -> system while the OS is already dark): swap
  // the glyph only. A reveal here would make the control look like it misfired.
  if (resolved === current) {
    applyTheme(resolved);
    commit();
    return;
  }

  const canTransition =
    !options.instant &&
    !switching &&
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    !prefersReducedMotion();

  if (!canTransition) {
    applyTheme(resolved);
    commit();
    return;
  }

  const root = document.documentElement;
  const x = options.x ?? window.innerWidth / 2;
  const y = options.y ?? window.innerHeight / 2;
  // Distance to the *farthest* corner, so the circle always covers the viewport.
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  switching = true;
  root.classList.add('theme-switching');

  const transition = document.startViewTransition(() => {
    applyTheme(resolved);
    commit();
  });

  transition.ready
    .then(() => {
      // The new screen grows out of the click point.
      root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: REVEAL_MS,
          easing: REVEAL_EASING,
          fill: 'both',
          pseudoElement: '::view-transition-new(root)',
        },
      );
      // The outgoing screen dims slightly, so the new one reads as covering it.
      root.animate(
        { opacity: [1, 0.72] },
        {
          duration: REVEAL_MS,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'both',
          pseudoElement: '::view-transition-old(root)',
        },
      );
    })
    .catch(() => undefined);

  transition.finished.finally(() => {
    switching = false;
    root.classList.remove('theme-switching');
  });
}
