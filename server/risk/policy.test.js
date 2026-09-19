import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPointEvent,
  canRequestAdvancePayout,
  computeLevel,
  payoutModeIsEligible,
} from "./policy.js";

const levels = [
  { level: 0, name: "Nuevo", minPoints: 0, minCompletedSales: 0, maxDisputeRateBps: 10000, active: true, advancePayoutAllowed: false },
  { level: 3, name: "Avanzado", minPoints: 1500, minCompletedSales: 50, maxDisputeRateBps: 500, active: true, advancePayoutAllowed: true },
  { level: 4, name: "Preferente", minPoints: 3000, minCompletedSales: 100, maxDisputeRateBps: 250, active: true, advancePayoutAllowed: true },
];

test("selects highest level satisfying all gates", () => {
  assert.equal(computeLevel(levels, { points: 2000, completedSales: 60, disputeRateBps: 400 }).level, 3);
  assert.equal(computeLevel(levels, { points: 5000, completedSales: 120, disputeRateBps: 200 }).level, 4);
});

test("payout mode cannot bypass level requirements", () => {
  assert.equal(payoutModeIsEligible("advance_payout", levels[1], {
    mode: "advance_payout", active: true, requiresLevel: 4, adminApprovalRequired: true,
  }), false);
});

test("advance payout requires active seller and no open dispute", () => {
  assert.equal(canRequestAdvancePayout({
    level: levels[2],
    policy: { mode: "advance_payout", active: true, requiresLevel: 4, adminApprovalRequired: true },
    hasOpenDispute: false,
    sellerStatus: "active",
  }), true);

  assert.equal(canRequestAdvancePayout({
    level: levels[2],
    policy: { mode: "advance_payout", active: true, requiresLevel: 4, adminApprovalRequired: true },
    hasOpenDispute: true,
    sellerStatus: "active",
  }), false);
});

test("points cannot be driven below zero", () => {
  assert.equal(applyPointEvent(100, -40), 60);
  assert.throws(() => applyPointEvent(20, -21), /points_cannot_be_negative/);
});
