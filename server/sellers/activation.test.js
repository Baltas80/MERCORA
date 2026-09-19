import test from "node:test";
import assert from "node:assert/strict";
import {
  canActivateSeller,
  calculateActivation,
  generatePromoCode,
  hashPromoCode,
  normalizeStoreName,
  normalizeStoreSlug,
} from "./activation.js";

test("normalizes a safe store slug", () => {
  assert.equal(normalizeStoreSlug("  My-Store  "), "my-store");
});

test("rejects unsafe store slug", () => {
  assert.throws(() => normalizeStoreSlug("my/store"), /invalid_store_slug/);
});

test("requires store name bounds", () => {
  assert.equal(normalizeStoreName("Mercora Shop"), "Mercora Shop");
  assert.throws(() => normalizeStoreName("x"), /invalid_store_name/);
});

test("generates high entropy promotion codes and stores only a digest", () => {
  const code = generatePromoCode();
  assert.ok(code.length >= 20);
  const digest = hashPromoCode(code);
  assert.equal(digest.length, 64);
  assert.notEqual(digest, code);
});

test("free store promotion makes activation free", () => {
  assert.deepEqual(
    calculateActivation("promo", 1000, { type: "free_store" }),
    { payableAtomic: 0n, source: "promo", benefitType: "free_store" },
  );
});

test("fixed and percent discounts never go below zero", () => {
  assert.equal(calculateActivation("promo", 1000, { type: "fee_discount_fixed", amountAtomic: 1500n }).payableAtomic, 0n);
  assert.equal(calculateActivation("promo", 1000, { type: "fee_discount_percent", percent: 25 }).payableAtomic, 750n);
});

test("paid activation requires verified payment", () => {
  assert.equal(canActivateSeller({ source: "paid", paymentStatus: "pending", promoRedeemed: false }), false);
  assert.equal(canActivateSeller({ source: "paid", paymentStatus: "verified", promoRedeemed: false }), true);
});

test("promo activation requires committed redemption", () => {
  assert.equal(canActivateSeller({ source: "promo", paymentStatus: "not_required", promoRedeemed: false }), false);
  assert.equal(canActivateSeller({ source: "promo", paymentStatus: "not_required", promoRedeemed: true }), true);
});
