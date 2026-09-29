const CONTROL_PATTERN = /^[^\\u0000-\\u001F\\u007F]+$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const SUPPORTED_ASSETS = Object.freeze({
  BTC: Object.freeze({ code: "BTC", atomicScale: 8 }),
  LTC: Object.freeze({ code: "LTC", atomicScale: 8 }),
  XMR: Object.freeze({ code: "XMR", atomicScale: 12 })
});

export const WITHDRAWAL_STATES = Object.freeze([
  "requested",
  "approved",
  "broadcast",
  "confirmed",
  "rejected",
  "cancelled"
]);

export const OBSERVATION_STATES = Object.freeze([
  "observed",
  "confirming",
  "confirmed"
]);

export const DIRECTIONS = Object.freeze(["deposit", "withdrawal"]);

export function assertSupportedAsset(assetCode) {
  if (typeof assetCode !== "string" || !Object.hasOwn(SUPPORTED_ASSETS, assetCode)) {
    throw new TypeError("Unsupported custody asset");
  }
  return SUPPORTED_ASSETS[assetCode];
}

export function assertNetwork(network) {
  if (typeof network !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(network)) {
    throw new TypeError("Invalid blockchain network");
  }
  return network;
}

export function assertAtomicAmount(amount, field = "amount_atomic") {
  if (typeof amount !== "string" && typeof amount !== "bigint") {
    throw new TypeError(`${field} must use a decimal string or bigint`);
  }

  const value = typeof amount === "bigint" ? amount : BigInt(amount);
  if (value <= 0n) throw new RangeError(`${field} must be positive`);
  return value;
}

export function assertIdempotencyKey(key) {
  if (typeof key !== "string" || !IDEMPOTENCY_PATTERN.test(key)) {
    throw new TypeError("Invalid idempotency key");
  }
  return key;
}

export function assertExternalIdentifier(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !CONTROL_PATTERN.test(value)) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

export function normalizeObservation(input) {
  if (!input || typeof input !== "object") throw new TypeError("Observation is required");

  const asset = assertSupportedAsset(input.assetCode);
  const network = assertNetwork(input.network);
  const txid = assertExternalIdentifier(input.txid, "txid");
  const direction = input.direction;

  if (!DIRECTIONS.includes(direction)) throw new TypeError("Invalid transaction direction");

  const amountAtomic = assertAtomicAmount(input.amountAtomic);
  const confirmations = Number(input.confirmations);

  if (!Number.isSafeInteger(confirmations) || confirmations < 0) {
    throw new TypeError("Invalid confirmation count");
  }

  const state = input.state ?? "observed";
  if (!OBSERVATION_STATES.includes(state)) {
    throw new TypeError("Invalid observation state");
  }

  return Object.freeze({
    assetCode: asset.code,
    network,
    txid,
    direction,
    amountAtomic,
    confirmations,
    state
  });
}

export function assertBalancedLedger(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new TypeError("A ledger transaction requires at least two entries");
  }

  const totals = new Map();

  for (const entry of entries) {
    assertSupportedAsset(entry.assetCode);
    if (!entry.accountId || typeof entry.accountId !== "string") {
      throw new TypeError("Invalid ledger account");
    }

    if (typeof entry.amountAtomic !== "string" && typeof entry.amountAtomic !== "bigint") {
      throw new TypeError("Ledger amounts must use decimal strings or bigint");
    }

    const amount = BigInt(entry.amountAtomic);
    if (amount === 0n) throw new RangeError("Ledger entry cannot be zero");

    totals.set(
      entry.assetCode,
      (totals.get(entry.assetCode) ?? 0n) + amount
    );
  }

  for (const [assetCode, total] of totals) {
    if (total !== 0n) {
      throw new Error(`Unbalanced ledger transaction for ${assetCode}`);
    }
  }

  return true;
}
