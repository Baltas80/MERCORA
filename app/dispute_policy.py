from __future__ import annotations
STATUSES={"open","awaiting_buyer","awaiting_seller","under_review","mediation","decided","appealed","resolved","closed","rejected"}
OUTCOMES={"buyer_refund","seller_release","partial_settlement","no_change","reject"}
TRANSITIONS={
"open":{"awaiting_buyer","awaiting_seller","under_review","rejected"},
"awaiting_buyer":{"under_review","mediation","rejected"},
"awaiting_seller":{"under_review","mediation","rejected"},
"under_review":{"mediation","decided","rejected"},
"mediation":{"decided","rejected"},
"decided":{"appealed","resolved"},
"appealed":{"under_review","resolved","rejected"},
}
def can_transition(current:str,target:str)->bool:
    if current in {"resolved","closed","rejected"}: return False
    return target in TRANSITIONS.get(current,set())
def valid_decision(outcome:str,rationale:str)->bool:
    return outcome in OUTCOMES and isinstance(rationale,str) and len(rationale.strip())>=10
