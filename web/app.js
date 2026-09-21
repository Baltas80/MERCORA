import { applyTranslations, getLocale, t } from "./i18n.js";

const ASSET_SCALE = Object.freeze({ BTC: 8, LTC: 8, XMR: 12 });
const state = {
  items: [],
  categories: [],
  cart: (() => {
    try {
      const stored = JSON.parse(localStorage.getItem("mercora_cart") || "[]");
      return Array.isArray(stored) ? stored.filter(item => item && item.id).map(item => ({ ...item, quantity: 1 })) : [];
    } catch {
      return [];
    }
  })(),
  locale: getLocale(),
  query: "",
  category: ""
};

const grid = document.querySelector("#productGrid");
const count = document.querySelector("#resultCount");
const message = document.querySelector("#catalogMessage");
const catalogStatus = document.querySelector("#catalogStatus");
const cartCount = document.querySelector("#cartCount");
const dialog = document.querySelector("#cartDialog");
const cartItems = document.querySelector("#cartItems");
const cartTotal = document.querySelector("#cartTotal");
const checkoutMessage = document.querySelector("#checkoutMessage");
const searchInput = document.querySelector("#searchInput");
const categoryGrid = document.querySelector("#categoryGrid");

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function atomicMoney(amount, asset) {
  const raw = String(amount ?? "0");
  const scale = ASSET_SCALE[asset] ?? 0;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale || padded.length);
  const fraction = scale ? "." + padded.slice(-scale).replace(/0+$/, "") : "";
  return (negative ? "-" : "") + whole + fraction + " " + text(asset);
}

function itemKey(item) {
  return String(item.id);
}

async function api(path) {
  const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function applySiteConfig() {
  try {
    const config = await api("./api/site-config");
    document.title = (config.site_name || "MERCORA") + " — Marketplace";
    const brand = document.querySelector(".brand");
    if (brand) brand.textContent = config.site_name || "MERCORA";
    for (const [selector, key] of [
      ["#heroTitle", "hero_title"], ["#heroCopy", "hero_copy"],
      ["#buyCta", "buy_cta"], ["#sellCta", "sell_cta"]
    ]) {
      const node = document.querySelector(selector);
      if (node && config[key]) node.textContent = config[key];
    }

    const announcement = document.querySelector("#siteAnnouncement");
    if (announcement) {
      announcement.textContent = config.announcement || "";
      announcement.hidden = !config.announcement;
    }

    const maintenance = document.querySelector("#maintenanceNotice");
    if (maintenance && config.site_mode === "maintenance") {
      maintenance.textContent = config.maintenance_message || "El marketplace está temporalmente en mantenimiento.";
      maintenance.hidden = false;
    }

    if (config.site_mode === "restricted") {
      const copy = document.querySelector(".hero-copy");
      if (copy) copy.textContent = "Acceso restringido. Algunas funciones del marketplace no están disponibles.";
    }

    const sellerButton = document.querySelector("#sellCta");
    if (sellerButton && config.seller_registration_enabled === "false") {
      sellerButton.textContent = "Registro de vendedores cerrado";
      sellerButton.classList.add("disabled");
      sellerButton.removeAttribute("href");
    }

    const footerName = document.querySelector("#footerSiteName");
    const footerNotice = document.querySelector("#footerNotice");
    if (footerName) footerName.textContent = config.site_name || "MERCORA";
    if (footerNotice) footerNotice.textContent = config.footer_notice || "Marketplace privado";

    if (config.site_mode === "maintenance") {
      document.querySelectorAll(".add, #checkoutButton").forEach((node) => {
        node.classList.add("disabled");
        node.setAttribute("aria-disabled", "true");
      });
    }
  } catch {
    // The catalog continues to load independently; defaults remain visible.
  }
}

function sellerLabel(item) {
  const sales = text(item.verified_sales_count, "0");
  const reviews = text(item.verified_rating_count, "0");
  const rating = item.rating_average === null || item.rating_average === undefined
    ? ""
    : " · ★ " + String(item.rating_average);
  return text(item.seller, "Vendedor") + " · ✓ " + sales + " ventas verificadas" + rating + " · " + reviews + " valoraciones";
}

function render() {
  applyTranslations(state.locale);
  count.textContent = state.items.length + " " + t("listings", state.locale);
  grid.replaceChildren();

  for (const item of state.items) {
    const card = document.createElement("article");
    card.className = "product";
    const art = document.createElement("div");
    art.className = "product-art";
    art.textContent = text(item.category, "MERCORA").slice(0, 3).toUpperCase();

    const body = document.createElement("div");
    body.className = "product-body";

    const title = document.createElement("h3");
    title.className = "product-title";
    const link = document.createElement("a");
    link.href = "./listing.html?id=" + encodeURIComponent(item.id);
    link.textContent = text(item.title);
    title.append(link);

    const meta = document.createElement("div");
    meta.className = "product-meta";
    const seller = document.createElement("div");
    seller.className = "seller-reputation";
    seller.textContent = sellerLabel(item);
    const category = document.createElement("div");
    category.textContent = text(item.category);
    meta.append(seller, category);

    const foot = document.createElement("div");
    foot.className = "product-footer";
    const price = document.createElement("span");
    price.className = "price";
    price.textContent = atomicMoney(item.price_atomic, item.price_asset);

    const add = document.createElement("button");
    add.className = "add";
    add.type = "button";
    add.dataset.id = itemKey(item);
    add.textContent = "AÑADIR";
    foot.append(price, add);

    body.append(title, meta, foot);
    card.append(art, body);
    grid.append(card);
  }

  message.hidden = state.items.length !== 0;
  if (!state.items.length) message.textContent = "No hay anuncios publicados con estos criterios.";
  renderCart();
}

function renderCategories() {
  categoryGrid.replaceChildren();
  for (const category of state.categories) {
    const button = document.createElement("button");
    button.className = "category";
    button.dataset.category = category.slug;
    button.textContent = category.name;
    button.addEventListener("click", () => loadListings({ category: category.slug }));
    categoryGrid.append(button);
  }
}

async function loadListings({ query = state.query, category = state.category } = {}) {
  state.query = query;
  state.category = category;
  catalogStatus.textContent = "CARGANDO";
  message.hidden = true;
  try {
    const params = new URLSearchParams({ limit: "48" });
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    const response = await api("./api/listings?" + params.toString());
    state.items = Array.isArray(response.listings) ? response.listings : [];
    catalogStatus.textContent = "CONECTADO";
    render();
  } catch (error) {
    state.items = [];
    catalogStatus.textContent = "NO DISPONIBLE";
    count.textContent = "—";
    message.hidden = false;
    message.textContent = "El catálogo no está disponible en este momento.";
    grid.replaceChildren();
    console.error(error);
  }
}

async function loadCategories() {
  try {
    const response = await api("./api/categories");
    state.categories = Array.isArray(response.categories) ? response.categories : [];
    renderCategories();
  } catch (error) {
    categoryGrid.replaceChildren();
    console.error(error);
  }
}

function saveCart() {
  try {
    localStorage.setItem("mercora_cart", JSON.stringify(state.cart));
  } catch {}
}

function renderCart() {
  cartItems.replaceChildren();
  if (!state.cart.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "El carrito está vacío.";
    cartItems.append(empty);
    cartTotal.textContent = "—";
  } else {
    const assets = new Set();
    let total = null;
    for (const item of state.cart) {
      assets.add(item.price_asset);
      const row = document.createElement("div");
      row.className = "cart-line";
      row.textContent = text(item.title) + " × " + item.quantity + " — " + atomicMoney(BigInt(item.price_atomic) * BigInt(item.quantity), item.price_asset);
      cartItems.append(row);
      if (total === null) total = BigInt(item.price_atomic) * BigInt(item.quantity);
      else if (assets.size === 1) total += BigInt(item.price_atomic) * BigInt(item.quantity);
    }
    cartTotal.textContent = assets.size === 1
      ? atomicMoney(String(total), [...assets][0])
      : "Varios activos";
  }
  cartCount.textContent = String(state.cart.reduce((sum, item) => sum + item.quantity, 0));
  saveCart();
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const item = state.items.find((candidate) => itemKey(candidate) === button.dataset.id);
  if (!item) return;
  const existing = state.cart.find((candidate) => candidate.id === item.id);
  if (existing) {
    existing.quantity = 1;
  } else {
    state.cart.push({ ...item, quantity: 1 });
  }
  renderCart();
});

document.querySelector("#searchForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  loadListings({ query: searchInput?.value.trim() || "", category: "" });
});

document.querySelector("#clearCategory")?.addEventListener("click", () => loadListings({ category: "" }));
document.querySelector("#cartButton")?.addEventListener("click", () => {
  renderCart();
  dialog?.showModal();
});
document.querySelector("#closeCart")?.addEventListener("click", () => dialog?.close());
document.querySelector("#checkoutButton")?.addEventListener("click", async () => {
  if (!state.cart.length) {
    checkoutMessage.textContent = "Añade al menos un anuncio al carrito.";
    return;
  }
  checkoutMessage.textContent = "Comprobando cuenta…";
  try {
    const account = await api("./api/auth/me");
    if (!account.account) {
      sessionStorage.setItem("mercora_checkout_return", "1");
      location.href = "./account.html";
      return;
    }
    const order = await api("./api/orders", {
      method: "POST",
      headers: {"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify({
        items: state.cart.map(item => ({ listing_id: item.id, quantity: 1 }))
      })
    });
    state.cart = [];
    saveCart();
    renderCart();
    checkoutMessage.textContent = "Pedido " + order.order.id + " creado. Estado: " + order.order.status + ".";
  } catch (error) {
    checkoutMessage.textContent = error.message || "No se pudo crear el pedido.";
  }
});

Promise.all([applySiteConfig(), loadCategories(), loadListings()]);
