import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../lib/constants';
import { isThemeSwitching } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';

const LABEL_KEY: Record<Theme, string> = {
  light: 'theme.light',
  dark: 'theme.dark',
};

/**
 * Viewport point the reveal grows from: the centre of the toggle itself.
 *
 * Derived from the control's own rect rather than from `clientX/clientY`, which
 * keeps the origin identical however the switch was triggered — mouse, touch,
 * Enter/Space, or a programmatic click (those carry 0,0 and used to send the
 * circle to the top-left corner). Expanding from the icon is also the more
 * legible choice: the icon is what the user is looking at.
 */
function originOf(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Three-state theme switch: system → light → dark → system.
 *
 * Two behaviours matter more than the glyphs:
 *
 * 1. All three icons stay mounted and only opacity/scale cross-fade. Swapping
 *    the child would either pop or, during a View Transition, briefly stack two
 *    different icons in the same spot.
 * 2. The click coordinates are handed to the store so the palette reveal can
 *    grow from where the user actually pressed.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setThemeMode } = useUI();
  const resolved: Theme = theme === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation();

  /* Binary: the two explicit palettes. `system` remains the default until the
     first click, it is just not a stop in the cycle. */
  const target: Theme = resolved === 'dark' ? 'light' : 'dark';
  const targetRef = useRef(target);
  targetRef.current = target;

  /*
   * Clicks that land while the reveal is running are delivered to the View
   * Transition snapshot layer, not to this button, so its own onClick never
   * fires. They do still reach `window` during capture, and `elementFromPoint`
   * sees through the snapshot to the real element.
   *
   * Without this, measuring three clicks 200ms apart on a 900ms reveal showed
   * only the first one taking effect — the control felt broken for the duration
   * of its own animation.
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!isThemeSwitching()) return; // the normal onClick path handles it
      /* `elementFromPoint` is useless here: while a transition runs it reports
         the root element, not what is visually under the cursor. A rectangle
         test does not depend on hit-testing at all. */
      const hit = [...document.querySelectorAll('[data-theme-toggle]')].some(
        (el) => {
          const rect = el.getBoundingClientRect();
          return (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          );
        },
      );
      if (!hit) return;
      /* Recovered clicks only carry coordinates, not the element, so the
         toggle in the DOM is the reference — there is exactly one. */
      const el = document.querySelector('[data-theme-toggle]');
      setThemeMode(
        targetRef.current,
        el ? originOf(el) : { x: event.clientX, y: event.clientY },
      );
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [setThemeMode]);

  return (
    <button
      type="button"
      data-theme-toggle=""
      onClick={(event) => {
        setThemeMode(target, originOf(event.currentTarget));
      }}
      aria-label={`${t('theme.label')}: ${t(LABEL_KEY[resolved])}`}
      title={`${t('theme.label')}: ${t(LABEL_KEY[resolved])}`}
      className={cn(
        'relative grid size-9 place-items-center overflow-hidden rounded-control',
        'text-fg-muted transition-colors duration-200',
        'hover:bg-surface-muted hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20',
        'active:scale-95',
        className,
      )}
    >
      <span className="relative size-[16px]">
        {(['light', 'dark'] as const).map((mode) => (
          <span
            key={mode}
            className={cn(
              'absolute inset-0 grid place-items-center',
              'transition-[opacity,transform] duration-300 ease-out',
              resolved === mode
                ? 'scale-100 opacity-100'
                : 'pointer-events-none scale-75 opacity-0',
            )}
            aria-hidden={resolved !== mode}
          >
            <Glyph mode={mode} />
          </span>
        ))}
      </span>
    </button>
  );
}

function Glyph({ mode }: { mode: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  /* system: a display, not a gear — it means "follow the device". */
  return (
    <svg {...common}>
      <rect x="2.5" y="4" width="19" height="13" rx="1.5" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
