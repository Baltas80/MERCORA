import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAtomicAmount,
  assertBalancedLedger,
  normalizeObservation
} from "./custody/contracts.js";
import { PaymentAdapter } from "./custody/payment-adapter.js";
import { BlockchainObserver } from "./custody/blockchain-observer.js";
import { SigningBoundary } from "./custody/signing-boundary.js";
import {
  canTransitionObservation,
  canTransitionWithdrawal,
  transitionObservation,
  transitionWithdrawal
} from "./custody/lifecycle.js";

test("custody assets accept BTC, LTC and XMR with atomic precision", () => {
  assert.equal(assertAtomicAmount("100"), 100n);
  assert.equal(assertAtomicAmount(123n), 123n);
  assert.throws(() => assertAtomicAmount(0n), /positive/);
  assert.throws(() => assertAtomicAmount(1), /decimal string or bigint/);
});

test("ledger contract requires balanced double-entry per asset", () => {
  assert.equal(assertBalancedLedger([
    { accountId: "acct-a", assetCode: "BTC", amountAtomic: "1000" },
    { accountId: "acct-b", assetCode: "BTC", amountAtomic: "-1000" }
  ]), true);

  assert.throws(() => assertBalancedLedger([
    { accountId: "acct-a", assetCode: "BTC", amountAtomic: "1000" },
    { accountId: "acct-b", assetCode: "BTC", amountAtomic: "-999" }
  ]), /Unbalanced/);
});

test("blockchain observations are normalized without floating point amounts", () => {
  const observation = normalizeObservation({
    assetCode: "XMR",
    network: "mainnet",
    txid: "tx-001",
    direction: "deposit",
    amountAtomic: "1234567890123",
    confirmations: 12
  });

  assert.equal(observation.assetCode, "XMR");
  assert.equal(observation.amountAtomic, 1234567890123n);
  assert.equal(observation.confirmations, 12);
  assert.equal(observation.state, "observed");
});

test("payment adapter keeps deposit and withdrawal contracts explicit", () => {
  assert.deepEqual(
    PaymentAdapter.validateWithdrawalRequest({
      accountId: "acct-a",
      network: "mainnet",
      destination: "destination-opaque",
      amountAtomic: "500",
      idempotencyKey: "withdrawal-001"
    }),
    {
      accountId: "acct-a",
      network: "mainnet",
      destination: "destination-opaque",
      amountAtomic: 500n,
      idempotencyKey: "withdrawal-001"
    }
  );

  const adapter = new PaymentAdapter("BTC");
  assert.rejects(
    () => adapter.requestWithdrawal({}),
    /isolated production adapter/
  );
});

test("blockchain observer and signer stay outside the application trust boundary", async () => {
  const observer = new BlockchainObserver("LTC");
  const signer = new SigningBoundary("XMR");

  assert.deepEqual(
    BlockchainObserver.validateTransactionReference({
      network: "mainnet",
      transactionId: "tx-002"
    }),
    { network: "mainnet", transactionId: "tx-002" }
  );

  await assert.rejects(
    () => observer.getTransaction({}),
    /isolated observer service/
  );

  await assert.rejects(
    () => signer.signWithdrawal({}),
    /isolated wallet\/signing service/
  );
});

test("withdrawal state machine rejects unsafe skips and backwards transitions", () => {
  assert.equal(canTransitionWithdrawal("requested", "approved"), true);
  assert.equal(canTransitionWithdrawal("approved", "broadcast"), true);
  assert.equal(canTransitionWithdrawal("broadcast", "confirmed"), true);
  assert.equal(canTransitionWithdrawal("requested", "confirmed"), false);
  assert.equal(canTransitionWithdrawal("confirmed", "requested"), false);
  assert.throws(
    () => transitionWithdrawal("requested", "broadcast"),
    /Invalid withdrawal transition/
  );
});

test("confirmation state machine is monotonic", () => {
  assert.equal(canTransitionObservation("observed", "confirming"), true);
  assert.equal(canTransitionObservation("confirming", "confirmed"), true);
  assert.equal(canTransitionObservation("confirmed", "observed"), false);
  assert.equal(
    transitionObservation("observed", "confirmed"),
    "confirmed"
  );
});
