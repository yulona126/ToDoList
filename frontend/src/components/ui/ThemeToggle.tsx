import { useTranslation } from 'react-i18next';
import { THEME_MODE_ORDER, type ThemeMode } from '../../lib/constants';
import { nextMode } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { useUI } from '../../stores/UIContext';

const LABEL_KEY: Record<ThemeMode, string> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

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
  const { themeMode, setThemeMode } = useUI();
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={(event) => {
        setThemeMode(nextMode(themeMode), {
          x: event.clientX,
          y: event.clientY,
        });
      }}
      aria-label={`${t('theme.label')}: ${t(LABEL_KEY[themeMode])}`}
      title={`${t('theme.label')}: ${t(LABEL_KEY[themeMode])}`}
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
        {THEME_MODE_ORDER.map((mode) => (
          <span
            key={mode}
            className={cn(
              'absolute inset-0 grid place-items-center',
              'transition-[opacity,transform] duration-300 ease-out',
              themeMode === mode
                ? 'scale-100 opacity-100'
                : 'pointer-events-none scale-75 opacity-0',
            )}
            aria-hidden={themeMode !== mode}
          >
            <Glyph mode={mode} />
          </span>
        ))}
      </span>
    </button>
  );
}

function Glyph({ mode }: { mode: ThemeMode }) {
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
