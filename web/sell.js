import { applyTranslations, getLocale, setLocale, t } from "./i18n.js";

const form = document.querySelector("#sellerForm");
const languageSelect = document.querySelector("#languageSelect");
const storeName = document.querySelector("#storeName");
const storeSlug = document.querySelector("#storeSlug");
const promoCode = document.querySelector("#promoCode");
const formMessage = document.querySelector("#formMessage");
const feeSummary = document.querySelector("#feeSummary");

function slugify(value) {
  return String(value).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function render() {
  const locale = getLocale();
  languageSelect.value = locale;
  applyTranslations(locale);
}

storeName.addEventListener("input", () => {
  if (!storeSlug.value) storeSlug.value = slugify(storeName.value);
});

languageSelect.addEventListener("change", () => {
  setLocale(languageSelect.value);
  render();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = storeName.value.trim();
  const slug = slugify(storeSlug.value);
  storeSlug.value = slug;

  if (name.length < 2 || name.length > 80) {
    formMessage.textContent = t("seller.invalidName");
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) {
    formMessage.textContent = t("seller.invalidSlug");
    return;
  }

  if (promoCode.value.trim()) {
    feeSummary.textContent = t("seller.promoPending");
  } else {
    feeSummary.textContent = t("seller.feePending");
  }
  formMessage.textContent = t("seller.serverRequired");
});

render();
