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
    "language.label": "Idioma", "language.es": "Español", "language.en": "English", "language.fr": "Français", "language.de": "Deutsch", "language.it": "Italiano", "language.pt": "Português",
    "seller.back": "Volver al marketplace", "seller.eyebrow": "TIENDA DE VENDEDOR", "seller.title": "Abre tu tienda en MERCORA", "seller.copy": "Abrir una tienda de vendedor requiere normalmente una tarifa de activación. Un código de invitación válido puede eliminarla o reducirla.", "seller.activation": "ACTIVACIÓN", "seller.storeName": "Nombre de la tienda", "seller.storeSlug": "Dirección de la tienda", "seller.paymentAsset": "Activo de pago", "seller.promo": "Código de invitación / promoción", "seller.feePending": "El servidor calculará la tarifa vigente para el activo seleccionado.", "seller.promoPending": "El servidor evaluará el código y mostrará el beneficio aplicable.", "seller.continue": "Continuar", "seller.rulesTitle": "REGLAS DE LA TIENDA", "seller.rule1": "El pago se verifica en el servidor", "seller.rule2": "Los canjes son atómicos", "seller.rule3": "La moderación sigue siendo obligatoria", "seller.rule4": "La activación no puede decidirla el cliente", "seller.invalidName": "El nombre debe tener entre 2 y 80 caracteres.", "seller.invalidSlug": "La dirección de la tienda no es válida.", "seller.serverRequired": "Los datos están validados localmente. La activación final requiere la API de MERCORA.",
  },
  en: {
    "nav.categories": "Categories", "nav.sell": "Sell", "nav.wallet": "Wallet", "nav.account": "Account", "nav.cart": "Cart", "search.placeholder": "Search products...", "search.button": "SEARCH",
    "hero.eyebrow": "PRIVATE MARKETPLACE · ONION SERVICE", "hero.title": "Buy. Sell. Keep control.", "hero.copy": "A second-hand marketplace built around privacy, strong security boundaries and a clean buying experience.", "hero.browse": "Browse listings", "hero.list": "List an item", "status.title": "SYSTEM STATUS", "status.onion": "Onion service", "status.trackers": "External trackers", "status.payments": "Payments", "status.ready": "READY", "status.none": "NONE", "explore.eyebrow": "EXPLORE", "categories.title": "Categories", "featured.eyebrow": "CURATED LISTINGS", "featured.title": "Featured", "wallet.eyebrow": "MERCORA CUSTODY", "wallet.title": "Wallets & payments", "wallet.copy": "The interface is prepared for isolated payment adapters. No production keys or wallet secrets are stored in the application source.", "footer.tagline": "Privacy-first marketplace", "cart.title": "Your cart", "cart.close": "Close", "cart.total": "Total", "cart.checkout": "Continue to checkout", "cart.empty": "Your cart is empty.", "product.add": "ADD", "listings": "listings", "seller": "Seller", "language.label": "Language", "language.es": "Español", "language.en": "English", "language.fr": "Français", "language.de": "Deutsch", "language.it": "Italiano", "language.pt": "Português",
    "seller.back": "Back to marketplace", "seller.eyebrow": "SELLER STORE", "seller.title": "Open your MERCORA store", "seller.copy": "Opening a seller store normally requires an activation fee. A valid invitation code can waive or reduce that fee.", "seller.activation": "ACTIVATION", "seller.storeName": "Store name", "seller.storeSlug": "Store address", "seller.paymentAsset": "Payment asset", "seller.promo": "Invitation / promotion code", "seller.feePending": "The server will calculate the current fee for the selected asset.", "seller.promoPending": "The server will evaluate the code and show the applicable benefit.", "seller.continue": "Continue", "seller.rulesTitle": "STORE RULES", "seller.rule1": "Payment is verified server-side", "seller.rule2": "Redemptions are atomic", "seller.rule3": "Moderation still applies", "seller.rule4": "Activation cannot be decided by the client", "seller.invalidName": "The name must be between 2 and 80 characters.", "seller.invalidSlug": "The store address is invalid.", "seller.serverRequired": "The data is validated locally. Final activation requires the MERCORA API.",
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
