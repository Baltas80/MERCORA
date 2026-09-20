import { createI18n } from './index.js';
import { detectLocale, resolveLocale } from './locales.js';

test('detects the first supported browser locale', () => {
  expect(detectLocale(['nl-NL', 'fr-FR', 'en-US'])).toBe('fr');
});

test('falls back to Spanish', () => {
  expect(detectLocale(['nl-NL'])).toBe('es');
});

test('stored locale takes precedence', () => {
  expect(resolveLocale({ storedLocale: 'en', browserLanguages: ['fr-FR'] })).toBe('en');
});

test('invalid stored locale falls back to browser detection', () => {
  expect(resolveLocale({ storedLocale: 'xx', browserLanguages: ['de-DE'] })).toBe('de');
});

test('catalog lookup never crashes and exposes Spanish UI strings', () => {
  const i18n = createI18n('es');
  expect(i18n.t('home.title')).toBe('Compra. Vende. Con privacidad.');
  expect(i18n.t('missing.key')).toBe('missing.key');
});
