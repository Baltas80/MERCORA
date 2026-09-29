import test from "node:test";
import assert from "node:assert/strict";

import { validateWithdrawalPolicy } from "./custody/policy.js";

const POLICY = Object.freeze({
  custodyMode: "normal",
  enabledAssets: ["BTC", "LTC", "XMR"],
  enabledNetworks: ["mainnet"],
  maxPerWithdrawalAtomic: {
    BTC: "1000000",
    LTC: "1000000",
    XMR: "1000000"
  },
  maxDailyAtomic: {
    BTC: "3000000",
    LTC: "3000000",
    XMR: "3000000"
  },
  approvalThresholdAtomic: {
    BTC: "500000",
    LTC: "500000",
    XMR: "500000"
  }
});

test("withdrawal policy is fail-closed outside normal mode", () => {
  assert.throws(
    () => validateWithdrawalPolicy(
      { assetCode: "BTC", network: "mainnet", amountAtomic: "10", availableAtomic: "10" },
      { ...POLICY, custodyMode: "frozen" }
    ),
    /frozen/
  );
});

test("withdrawal policy enforces asset, network, transaction and daily limits", () => {
  assert.throws(
    () => validateWithdrawalPolicy(
      { assetCode: "BTC", network: "mainnet", amountAtomic: "1000001", availableAtomic: "2000000" },
      POLICY
    ),
    /per-transaction/
  );

  assert.throws(
    () => validateWithdrawalPolicy(
      { assetCode: "BTC", network: "testnet", amountAtomic: "10", availableAtomic: "20" },
      POLICY
    ),
    /disabled/
  );

  assert.throws(
    () => validateWithdrawalPolicy(
      { assetCode: "BTC", network: "mainnet", amountAtomic: "1000000", availableAtomic: "2000000", spentTodayAtomic: "2100000" },
      POLICY
    ),
    /daily/
  );
});

test("withdrawal policy uses atomic units and exposes an approval boundary", () => {
  const result = validateWithdrawalPolicy(
    {
      assetCode: "XMR",
      network: "mainnet",
      amountAtomic: "500000",
      availableAtomic: "700000",
      spentTodayAtomic: "100000"
    },
    POLICY
  );

  assert.equal(result.amountAtomic, 500000n);
  assert.equal(result.requiresAdditionalApproval, true);

  assert.throws(
    () => validateWithdrawalPolicy(
      {
        assetCode: "XMR",
        network: "mainnet",
        amountAtomic: 1,
        availableAtomic: "100"
      },
      POLICY
    ),
    /decimal string or bigint/
  );
});

test("missing policy limits are rejected instead of defaulting to permissive values", () => {
  const incomplete = {
    ...POLICY,
    maxDailyAtomic: { BTC: "3000000" }
  };

  assert.throws(
    () => validateWithdrawalPolicy(
      { assetCode: "LTC", network: "mainnet", amountAtomic: "10", availableAtomic: "100" },
      incomplete
    ),
    /missing maxDailyAtomic/
  );
});
