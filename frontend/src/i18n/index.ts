import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  STORAGE_KEYS,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../lib/constants';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

export const DAYJS_LOCALES: Record<Language, string> = {
  'zh-CN': 'zh-cn',
  'en-US': 'en',
};

export function isSupportedLanguage(
  value: string | null | undefined,
): value is Language {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.lang);
  } catch {
    return null;
  }
}

/**
 * Reset order per spec: localStorage → navigator.language → zh-CN.
 */
export function detectLanguage(): Language {
  const stored = readStoredLanguage();
  if (isSupportedLanguage(stored)) return stored;

  const navigatorLanguage =
    typeof navigator === 'undefined' ? '' : navigator.language;
  const lower = navigatorLanguage.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en-US';

  return DEFAULT_LANGUAGE;
}

/** dayjs follows the app language (relative time + date formatting). */
export function syncDayjsLocale(language: Language): void {
  dayjs.locale(DAYJS_LOCALES[language]);
}

const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
});

syncDayjsLocale(initialLanguage);

/** Translate outside of React (axios helpers, error normalisation). */
export function translate(key: string): string {
  return i18n.t(key);
}

export default i18n;
