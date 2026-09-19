import es from './es.js';

const catalogs = Object.freeze({ es });

export function createI18n(locale = 'es') {
  const catalog = catalogs[locale] || catalogs.es;
  return {
    locale: catalogs[locale] ? locale : 'es',
    t(key) {
      return key.split('.').reduce((value, part) => value?.[part], catalog) ?? key;
    },
  };
}

export { catalogs };
