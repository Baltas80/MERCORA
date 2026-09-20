export const DISPUTE_STATUSES = Object.freeze([
  "open", "awaiting_buyer", "awaiting_seller", "under_review",
  "mediation", "decided", "appealed", "resolved", "closed", "rejected",
]);

export const DISPUTE_OUTCOMES = Object.freeze([
  "buyer_refund", "seller_release", "partial_settlement", "no_change", "reject",
]);

export function canOpenDispute({ orderStatus, actorIsBuyer, actorIsSeller }) {
  const eligibleOrderStates = new Set(["paid", "processing", "shipped", "completed", "disputed"]);
  return eligibleOrderStates.has(orderStatus) && (actorIsBuyer || actorIsSeller);
}

export function canSubmitEvidence({ disputeStatus, actorIsParty, actorIsModerator }) {
  return ["open", "awaiting_buyer", "awaiting_seller", "under_review", "mediation", "appealed"].includes(disputeStatus)
    && (actorIsParty || actorIsModerator);
}

export function canDecideDispute({ disputeStatus, actorIsModerator, rationale, outcome }) {
  return ["under_review", "mediation"].includes(disputeStatus)
    && actorIsModerator
    && typeof rationale === "string"
    && rationale.trim().length >= 10
    && DISPUTE_OUTCOMES.includes(outcome);
}

export function outcomeRequiresFinancialExecution(outcome) {
  return outcome === "buyer_refund" || outcome === "seller_release" || outcome === "partial_settlement";
}

export function canOpenAppeal({ disputeStatus, actorIsParty }) {
  return disputeStatus === "decided" && actorIsParty;
}
