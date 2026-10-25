import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import i18n, { detectLanguage, syncDayjsLocale } from '../i18n';
import {
  STORAGE_KEYS,
  type Language,
  type Theme,
  type ThemeMode,
} from '../lib/constants';
import {
  applyTheme,
  nextMode,
  readStoredMode,
  resolveTheme,
  switchTheme,
  systemTheme,
  type SwitchOptions,
} from '../lib/theme';
import { cn } from '../lib/utils';

export type ToastType = 'success' | 'error';

export interface ToastInput {
  type: ToastType;
  message: string;
}

export interface ToastItem extends ToastInput {
  id: string;
}

interface UIContextValue {
  /** The palette that is actually painted right now. */
  theme: Theme;
  /** What the user chose: 'system' follows the OS. */
  themeMode: ThemeMode;
  setTheme: (theme: Theme) => void;
  setThemeMode: (mode: ThemeMode, options?: SwitchOptions) => void;
  toggleTheme: () => void;
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  toasts: ToastItem[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

const TOAST_TTL_MS = 3_500;

let toastSequence = 0;

function storedMode(): ThemeMode {
  try {
    return readStoredMode(window.localStorage.getItem(STORAGE_KEYS.theme)) ?? 'system';
  } catch {
    return 'system';
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* preferences simply stop persisting when storage is unavailable */
  }
}

export function UIProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(storedMode);
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme(storedMode()));
  const [language, setLanguageState] = useState<Language>(() =>
    detectLanguage(),
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  /* Keep the <html> class + persistence in sync with the painted theme. */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    persist(STORAGE_KEYS.theme, themeMode);
  }, [themeMode]);

  /* While in `system` mode, follow the OS live — without the wipe, which would
     be startling when the change was not user-initiated. */
  useEffect(() => {
    if (themeMode !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeState(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [themeMode]);

  const setThemeMode = useCallback(
    (mode: ThemeMode, options?: SwitchOptions) => {
      switchTheme(
        mode,
        theme,
        () => {
          setThemeModeState(mode);
          setThemeState(resolveTheme(mode));
        },
        options,
      );
    },
    [theme],
  );

  const setTheme = useCallback(
    (next: Theme) => setThemeMode(next),
    [setThemeMode],
  );

  const toggleTheme = useCallback(() => {
    setThemeMode(nextMode(themeMode));
  }, [setThemeMode, themeMode]);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = `toast-${Date.now()}-${(toastSequence += 1)}`;
      setToasts((current) => [...current, { ...toast, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_TTL_MS),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    persist(STORAGE_KEYS.lang, next);
    syncDayjsLocale(next);
    void i18n.changeLanguage(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const next: Language = current === 'zh-CN' ? 'en-US' : 'zh-CN';
      persist(STORAGE_KEYS.lang, next);
      syncDayjsLocale(next);
      void i18n.changeLanguage(next);
      return next;
    });
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      theme,
      themeMode,
      setTheme,
      setThemeMode,
      toggleTheme,
      language,
      setLanguage,
      toggleLanguage,
      toasts,
      push,
      dismiss,
    }),
    [
      theme,
      themeMode,
      setTheme,
      setThemeMode,
      toggleTheme,
      language,
      setLanguage,
      toggleLanguage,
      toasts,
      push,
      dismiss,
    ],
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} label={t('common.dismiss')} />
    </UIContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
  label,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  label: string;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4"
      data-testid="toast-viewport"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto flex w-full max-w-toast items-start gap-2',
            'rounded-card border border-border bg-surface px-3 py-2 text-secondary text-fg',
            'shadow-modal motion-safe-150',
          )}
        >
          <Icon
            name={toast.type === 'error' ? 'alert' : 'check'}
            size={14}
            className="mt-0.5 shrink-0 text-fg-muted"
          />
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label={label}
            className={cn(
              '-mr-1 -mt-0.5 shrink-0 rounded-control p-1 text-fg-subtle',
              'hover:bg-surface-muted hover:text-fg motion-safe-150',
            )}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useUI(): UIContextValue {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used inside <UIProvider>');
  }
  return context;
}
