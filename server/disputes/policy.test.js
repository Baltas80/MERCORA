import test from "node:test";
import assert from "node:assert/strict";
import {
  canDecideDispute,
  canOpenAppeal,
  canOpenDispute,
  canSubmitEvidence,
  outcomeRequiresFinancialExecution,
} from "./policy.js";

test("buyer or seller can open a dispute only for eligible order states", () => {
  assert.equal(canOpenDispute({ orderStatus: "shipped", actorIsBuyer: true, actorIsSeller: false }), true);
  assert.equal(canOpenDispute({ orderStatus: "pending", actorIsBuyer: true, actorIsSeller: false }), false);
});

test("evidence is limited to active dispute workflow participants or moderators", () => {
  assert.equal(canSubmitEvidence({ disputeStatus: "under_review", actorIsParty: true, actorIsModerator: false }), true);
  assert.equal(canSubmitEvidence({ disputeStatus: "closed", actorIsParty: true, actorIsModerator: false }), false);
});

test("moderator decisions require an active review state and rationale", () => {
  assert.equal(canDecideDispute({
    disputeStatus: "under_review", actorIsModerator: true,
    rationale: "Evidence supports a refund under the marketplace policy.", outcome: "buyer_refund",
  }), true);
  assert.equal(canDecideDispute({
    disputeStatus: "open", actorIsModerator: true,
    rationale: "Evidence supports a refund under the marketplace policy.", outcome: "buyer_refund",
  }), false);
});

test("financial dispute outcomes are sent to the guarded financial service", () => {
  assert.equal(outcomeRequiresFinancialExecution("buyer_refund"), true);
  assert.equal(outcomeRequiresFinancialExecution("seller_release"), true);
  assert.equal(outcomeRequiresFinancialExecution("partial_settlement"), true);
  assert.equal(outcomeRequiresFinancialExecution("reject"), false);
});

test("appeals can only be opened after a decision", () => {
  assert.equal(canOpenAppeal({ disputeStatus: "decided", actorIsParty: true }), true);
  assert.equal(canOpenAppeal({ disputeStatus: "open", actorIsParty: true }), false);
});
