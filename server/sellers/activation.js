import { createHash, randomBytes } from "node:crypto";

export const SELLER_STATUSES = Object.freeze(["pending", "active", "suspended", "closed"]);
export const ACTIVATION_SOURCES = Object.freeze(["paid", "promo"]);
export const PAYMENT_STATES = Object.freeze(["not_required", "pending", "verified", "rejected"]);
export const PROMO_TYPES = Object.freeze(["free_store", "fee_discount_fixed", "fee_discount_percent"]);

export function normalizeStoreSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) throw new Error("invalid_store_slug");
  return slug;
}

export function normalizeStoreName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 80) throw new Error("invalid_store_name");
  return name;
}

export function generatePromoCode(bytes = 20) {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) throw new Error("invalid_code_entropy");
  return randomBytes(bytes).toString("base64url");
}

export function hashPromoCode(code) {
  const normalized = String(code ?? "").trim();
  if (normalized.length < 20) throw new Error("invalid_promo_code");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function calculateActivation(source, feeAtomic, benefit = null) {
  if (!ACTIVATION_SOURCES.includes(source)) throw new Error("invalid_activation_source");

  if (source === "promo" && benefit?.type === "free_store") {
    return { payableAtomic: 0n, source: "promo", benefitType: "free_store" };
  }

  if (!Number.isInteger(feeAtomic) && typeof feeAtomic !== "bigint") throw new Error("invalid_fee");
  if (feeAtomic <= 0) throw new Error("invalid_fee");

  if (!benefit) return { payableAtomic: BigInt(feeAtomic), source: "paid", benefitType: null };

  if (benefit.type === "fee_discount_fixed") {
    const discount = BigInt(benefit.amountAtomic);
    if (discount <= 0n) throw new Error("invalid_discount");
    const fee = BigInt(feeAtomic);
    return { payableAtomic: discount >= fee ? 0n : fee - discount, source: "promo", benefitType: benefit.type };
  }

  if (benefit.type === "fee_discount_percent") {
    if (!Number.isInteger(benefit.percent) || benefit.percent < 1 || benefit.percent > 100) throw new Error("invalid_discount");
    const payable = (BigInt(feeAtomic) * BigInt(100 - benefit.percent)) / 100n;
    return { payableAtomic: payable, source: "promo", benefitType: benefit.type };
  }

  throw new Error("invalid_discount_type");
}

export function canActivateSeller({ source, paymentStatus, promoRedeemed }) {
  if (source === "paid") return paymentStatus === "verified";
  if (source === "promo") return promoRedeemed === true;
  return false;
}
