import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicAdminPayload,
  assertPanicTransition,
  buildSweepRequest
} from "./admin-emergency-control.js";

test("admin payload rejects signing and wallet secrets", () => {
  assert.throws(() => assertPublicAdminPayload({ status: "OK", privateKey: "x" }));
  assert.throws(() => assertPublicAdminPayload({ nested: { mnemonic: "x" } }));
  assert.doesNotThrow(() => assertPublicAdminPayload({ status: "OK", balances: { BTC: "0" } }));
});

test("panic state machine is fail-closed", () => {
  assert.equal(assertPanicTransition("normal", "FREEZE"), true);
  assert.throws(() => assertPanicTransition("normal", "REQUEST_SWEEP"));
  assert.equal(assertPanicTransition("frozen", "REQUEST_SWEEP"), true);
  assert.throws(() => assertPanicTransition("sweep_executing", "REQUEST_SWEEP"));
});

test("sweep request requires exactly BTC and XMR destinations", () => {
  const request = buildSweepRequest({
    operationId: "panic-20260929-001",
    reason: "Security incident",
    destinations: [
      { assetCode: "BTC", destination: "bc1q-emergency" },
      { assetCode: "XMR", destination: "4-emergency" }
    ]
  });
  assert.deepEqual(request.destinations.map((entry) => entry.assetCode), ["BTC", "XMR"]);
  assert.throws(() => buildSweepRequest({
    operationId: "panic-20260929-002",
    reason: "test",
    destinations: [{ assetCode: "BTC", destination: "x" }]
  }));
  assert.throws(() => buildSweepRequest({
    operationId: "panic-20260929-003",
    reason: "test",
    destinations: [
      { assetCode: "BTC", destination: "x" },
      { assetCode: "BTC", destination: "y" }
    ]
  }));
});
