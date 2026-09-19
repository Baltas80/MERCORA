import test from "node:test";
import assert from "node:assert/strict";
import { authorizeAdminAction } from "./policy.js";

test("normal admin read action requires only permission", () => {
  assert.deepEqual(
    authorizeAdminAction({ permission: "users.read", permissions: ["users.read"] }),
    { allowed: true, reason: "authorized" },
  );
});

test("financial action requires step-up and second approval", () => {
  assert.equal(
    authorizeAdminAction({ permission: "payouts.approve", permissions: ["payouts.approve"], stepUpVerified: false, secondApproverVerified: true }).allowed,
    false,
  );
  assert.equal(
    authorizeAdminAction({ permission: "payouts.approve", permissions: ["payouts.approve"], stepUpVerified: true, secondApproverVerified: false }).allowed,
    false,
  );
  assert.equal(
    authorizeAdminAction({ permission: "payouts.approve", permissions: ["payouts.approve"], stepUpVerified: true, secondApproverVerified: true }).allowed,
    true,
  );
});
