# MERCORA authorization model

## Principle

Authorization is enforced server-side at the resource boundary. A client-visible role or identifier is never treated as proof of permission.

## Initial roles

- `buyer`: purchase and manage the buyer's own resources.
- `seller`: manage the seller's own listings and inventory.
- `moderator`: perform explicitly scoped moderation actions.
- `admin`: perform administrative actions requiring elevated privilege.

## Ownership rule

A seller may modify a listing only when the authenticated account owns the listing. Moderators and administrators may act only through dedicated privileged paths with explicit authorization checks.

## Security requirements

- Deny by default.
- Never authorize from user-supplied object IDs alone.
- Enforce ownership in the service/domain layer and, where appropriate, again at the database query boundary.
- Prevent horizontal privilege escalation between buyer/seller accounts.
- Separate moderation and administration privileges.
- Record security-relevant administrative actions in an intentionally minimized audit trail.
- Tests must cover both allowed and denied paths.

This document defines the initial model; payment, dispute, messaging and moderation permissions will be expanded before those features become production-capable.
