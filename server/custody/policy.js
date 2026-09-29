import {
  assertAtomicAmount,
  assertNetwork,
  assertSupportedAsset
} from "./contracts.js";

function positiveOrZeroAtomic(value, field) {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw new TypeError(`${field} must use a decimal string or bigint`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n) throw new RangeError(`${field} cannot be negative`);
  return parsed;
}

function requireLimit(policy, assetCode, field) {
  const value = policy?.[field]?.[assetCode];
  if (value === undefined || value === null) {
    throw new Error(`Custody policy missing ${field} for ${assetCode}`);
  }
  return positiveOrZeroAtomic(value, `${field}.${assetCode}`);
}

export function validateWithdrawalPolicy(request, policy) {
  if (!request || typeof request !== "object") {
    throw new TypeError("Withdrawal policy request is required");
  }

  if (!policy || typeof policy !== "object") {
    throw new TypeError("Custody policy is required");
  }

  const asset = assertSupportedAsset(request.assetCode);
  const network = assertNetwork(request.network);

  if (policy.custodyMode !== "normal") {
    throw new Error("Withdrawals are frozen outside normal custody mode");
  }

  const enabledAssets = Array.isArray(policy.enabledAssets) ? policy.enabledAssets : [];
  if (!enabledAssets.includes(asset.code)) {
    throw new Error(`Asset ${asset.code} is disabled by custody policy`);
  }

  const enabledNetworks = Array.isArray(policy.enabledNetworks) ? policy.enabledNetworks : [];
  if (!enabledNetworks.includes(network)) {
    throw new Error(`Network ${network} is disabled by custody policy`);
  }

  const amountAtomic = assertAtomicAmount(request.amountAtomic);
  const availableAtomic = positiveOrZeroAtomic(request.availableAtomic, "availableAtomic");
  const spentTodayAtomic = positiveOrZeroAtomic(request.spentTodayAtomic ?? 0n, "spentTodayAtomic");

  const maxPerWithdrawalAtomic = requireLimit(policy, asset.code, "maxPerWithdrawalAtomic");
  const maxDailyAtomic = requireLimit(policy, asset.code, "maxDailyAtomic");
  const approvalThresholdAtomic = requireLimit(policy, asset.code, "approvalThresholdAtomic");

  if (amountAtomic > maxPerWithdrawalAtomic) {
    throw new Error(`Withdrawal exceeds per-transaction limit for ${asset.code}`);
  }

  if (amountAtomic > availableAtomic) {
    throw new Error("Insufficient available custody balance");
  }

  if (spentTodayAtomic + amountAtomic > maxDailyAtomic) {
    throw new Error(`Withdrawal exceeds daily limit for ${asset.code}`);
  }

  return Object.freeze({
    assetCode: asset.code,
    network,
    amountAtomic,
    availableAtomic,
    spentTodayAtomic,
    requiresAdditionalApproval: amountAtomic >= approvalThresholdAtomic
  });
}
