export const SUPPORTED_LOCALES = Object.freeze([
  { code: 'es', label: 'Español', nativeLabel: 'Español' },
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'fr', label: 'Français', nativeLabel: 'Français' },
  { code: 'de', label: 'Deutsch', nativeLabel: 'Deutsch' },
  { code: 'it', label: 'Italiano', nativeLabel: 'Italiano' },
  { code: 'pt', label: 'Português', nativeLabel: 'Português' },
]);

export const DEFAULT_LOCALE = 'es';

export function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.some(({ code }) => code === value);
}

export function detectLocale(browserLanguages = []) {
  for (const language of browserLanguages) {
    const base = String(language).toLowerCase().split('-')[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale({ storedLocale, browserLanguages = [] } = {}) {
  if (storedLocale && isSupportedLocale(storedLocale)) return storedLocale;
  return detectLocale(browserLanguages);
}
