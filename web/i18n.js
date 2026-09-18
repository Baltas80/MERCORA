const SUPPORTED_LOCALES = ["es", "en", "fr", "de", "it", "pt"];
const DEFAULT_LOCALE = "es";

const MESSAGES = {
  es: {
    "nav.categories": "Categorías", "nav.sell": "Vender", "nav.wallet": "Billetera", "nav.account": "Cuenta", "nav.cart": "Carrito",
    "search.placeholder": "Buscar productos...", "search.button": "BUSCAR",
    "hero.eyebrow": "MERCADO PRIVADO · ONION SERVICE", "hero.title": "Compra. Vende. Mantén el control.",
    "hero.copy": "Un marketplace de segunda mano basado en privacidad, límites de seguridad sólidos y una experiencia de compra limpia.",
    "hero.browse": "Explorar productos", "hero.list": "Publicar producto", "status.title": "ESTADO DEL SISTEMA",
    "status.onion": "Servicio Onion", "status.trackers": "Trackers externos", "status.payments": "Pagos", "status.ready": "LISTO", "status.none": "NINGUNO",
    "explore.eyebrow": "EXPLORAR", "categories.title": "Categorías", "featured.eyebrow": "ANUNCIOS SELECCIONADOS", "featured.title": "Destacados",
    "wallet.eyebrow": "CUSTODIA MERCORA", "wallet.title": "Billeteras y pagos", "wallet.copy": "La interfaz está preparada para adaptadores de pago aislados. No se almacenan claves de producción ni secretos de billetera en el código.",
    "footer.tagline": "Marketplace centrado en la privacidad", "cart.title": "Tu carrito", "cart.close": "Cerrar", "cart.total": "Total", "cart.checkout": "Continuar al pago", "cart.empty": "Tu carrito está vacío.", "product.add": "AÑADIR", "listings": "anuncios", "seller": "Vendedor",
    "language.label": "Idioma", "language.es": "Español", "language.en": "English", "language.fr": "Français", "language.de": "Deutsch", "language.it": "Italiano", "language.pt": "Português"
  },
  en: {
    "nav.categories": "Categories", "nav.sell": "Sell", "nav.wallet": "Wallet", "nav.account": "Account", "nav.cart": "Cart", "search.placeholder": "Search products...", "search.button": "SEARCH",
    "hero.eyebrow": "PRIVATE MARKETPLACE · ONION SERVICE", "hero.title": "Buy. Sell. Keep control.", "hero.copy": "A second-hand marketplace built around privacy, strong security boundaries and a clean buying experience.", "hero.browse": "Browse listings", "hero.list": "List an item", "status.title": "SYSTEM STATUS", "status.onion": "Onion service", "status.trackers": "External trackers", "status.payments": "Payments", "status.ready": "READY", "status.none": "NONE", "explore.eyebrow": "EXPLORE", "categories.title": "Categories", "featured.eyebrow": "CURATED LISTINGS", "featured.title": "Featured", "wallet.eyebrow": "MERCORA CUSTODY", "wallet.title": "Wallets & payments", "wallet.copy": "The interface is prepared for isolated payment adapters. No production keys or wallet secrets are stored in the application source.", "footer.tagline": "Privacy-first marketplace", "cart.title": "Your cart", "cart.close": "Close", "cart.total": "Total", "cart.checkout": "Continue to checkout", "cart.empty": "Your cart is empty.", "product.add": "ADD", "listings": "listings", "seller": "Seller", "language.label": "Language", "language.es": "Español", "language.en": "English", "language.fr": "Français", "language.de": "Deutsch", "language.it": "Italiano", "language.pt": "Português"
  }
};

for (const locale of SUPPORTED_LOCALES) MESSAGES[locale] ??= MESSAGES.en;

export function resolveLocale(preferred) {
  const values = Array.isArray(preferred) ? preferred : [preferred];
  for (const value of values) {
    const normalized = String(value ?? "").toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LOCALES.includes(normalized)) return normalized;
  }
  return DEFAULT_LOCALE;
}

export function detectLocale() {
  return resolveLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function getLocale() {
  const saved = localStorage.getItem("mercora.locale");
  return SUPPORTED_LOCALES.includes(saved) ? saved : detectLocale();
}

export function setLocale(locale) {
  const resolved = resolveLocale(locale);
  localStorage.setItem("mercora.locale", resolved);
  return resolved;
}

export function t(key, locale = getLocale()) {
  return MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
}

export function applyTranslations(locale = getLocale()) {
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n, locale);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder, locale));
  });
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
