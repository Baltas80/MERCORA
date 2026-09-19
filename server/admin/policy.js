const HIGH_RISK_PERMISSIONS = new Set([
  "withdrawals.approve",
  "payouts.approve",
  "escrow.manage",
  "emergency.manage",
]);

export function hasPermission(permission, permissions) {
  return permissions instanceof Set ? permissions.has(permission) : Array.isArray(permissions) && permissions.includes(permission);
}

export function requiresStepUp(permission) {
  return HIGH_RISK_PERMISSIONS.has(permission);
}

export function authorizeAdminAction({ permission, permissions, stepUpVerified = false, secondApproverVerified = false }) {
  if (!hasPermission(permission, permissions)) return { allowed: false, reason: "permission_denied" };
  if (requiresStepUp(permission) && !stepUpVerified) return { allowed: false, reason: "step_up_required" };
  if (requiresStepUp(permission) && !secondApproverVerified) return { allowed: false, reason: "second_approval_required" };
  return { allowed: true, reason: "authorized" };
}
