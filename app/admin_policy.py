from __future__ import annotations
HIGH_RISK={"withdrawals.approve","payouts.approve","escrow.manage","emergency.manage"}

def has_permission(permission:str,permissions:set[str])->bool:
    return permission in permissions

def authorize(permission:str,permissions:set[str],step_up:bool=False,second_approver:bool=False)->tuple[bool,str]:
    if permission not in permissions: return False,"permission_denied"
    if permission in HIGH_RISK and not step_up: return False,"step_up_required"
    if permission in HIGH_RISK and not second_approver: return False,"second_approval_required"
    return True,"authorized"

def is_high_risk(permission:str)->bool:
    return permission in HIGH_RISK
