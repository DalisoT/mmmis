import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './en.json';
import bem from './bem.json';

/**
 * i18next initialisation for the MMMIS front-end.
 *
 * Scope of this initial P6 commit:
 *   * Two locales: `en` (default) and `bem` (Bemba).
 *   * Nav labels and the Settings page are fully translated.
 *   * Other pages still render hard-coded English strings — they will be
 *     migrated in subsequent P-letters. Adding the bundle now means
 *     pages can call `useTranslation()` immediately without re-wiring.
 *
 * Persistence: language is detected from `localStorage.i18nextLng` (set
 * by `i18next-browser-languagedetector`) with a fallback to the
 * browser's `navigator.language`. Switching is exposed by the
 * `LanguageSwitcher` component (rendered in the app header).
 */
export const SUPPORTED_LANGUAGES = ['en', 'bem'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      bem: { translation: bem },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: {
      escapeValue: false, // React already escapes interpolated content.
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'mmmis.lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
