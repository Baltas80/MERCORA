const SUPPORTED_LOCALES=["es","en","fr","de","it","pt"],DEFAULT_LOCALE="es";
const M={es:{"listings":"anuncios"},en:{"listings":"listings"},fr:{"listings":"annonces"},de:{"listings":"Angebote"},it:{"listings":"annunci"},pt:{"listings":"anúncios"}};
function resolveLocale(preferred){for(const value of Array.isArray(preferred)?preferred:[preferred]){const normalized=String(value||"").toLowerCase().split(/[-_]/)[0];if(SUPPORTED_LOCALES.includes(normalized))return normalized}return DEFAULT_LOCALE}
function detectLocale(){return resolveLocale(navigator.languages?.length?navigator.languages:[navigator.language])}
function getLocale(){const saved=localStorage.getItem("mercora.locale");return SUPPORTED_LOCALES.includes(saved)?saved:detectLocale()}
function setLocale(locale){const resolved=resolveLocale(locale);localStorage.setItem("mercora.locale",resolved);return resolved}
function t(key,locale=getLocale()){return M[locale]?.[key]??M.en[key]??key}
function applyTranslations(locale=getLocale()){document.documentElement.lang=locale;document.querySelectorAll("[data-i18n]").forEach(e=>e.textContent=t(e.dataset.i18n,locale));document.querySelectorAll("[data-i18n-placeholder]").forEach(e=>e.placeholder=t(e.dataset.i18nPlaceholder,locale))}
export{DEFAULT_LOCALE,SUPPORTED_LOCALES,getLocale,setLocale,t,applyTranslations,resolveLocale,detectLocale};
