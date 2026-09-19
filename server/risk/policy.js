export const SELLER_PAYOUT_MODES = Object.freeze([
  "standard_escrow",
  "early_release",
  "advance_payout",
]);

export function computeLevel(levels, { points = 0, completedSales = 0, disputeRateBps = 0 } = {}) {
  return [...levels]
    .filter((level) =>
      level.active !== false &&
      points >= level.minPoints &&
      completedSales >= level.minCompletedSales &&
      disputeRateBps <= level.maxDisputeRateBps
    )
    .sort((a, b) => b.level - a.level)[0] ?? null;
}

export function payoutModeIsEligible(mode, level, policy) {
  if (!policy || !level) return false;
  if (mode !== policy.mode || policy.active === false) return false;
  return level.level >= policy.requiresLevel;
}

export function canRequestAdvancePayout({ level, policy, hasOpenDispute = false, sellerStatus = "active" }) {
  if (sellerStatus !== "active" || hasOpenDispute) return false;
  return payoutModeIsEligible("advance_payout", level, policy)
    && level.advancePayoutAllowed === true
    && policy.adminApprovalRequired === true;
}

export function applyPointEvent(currentPoints, delta) {
  const next = currentPoints + delta;
  if (!Number.isInteger(delta) || delta === 0) throw new Error("invalid_points_delta");
  if (next < 0) throw new Error("points_cannot_be_negative");
  return next;
}
