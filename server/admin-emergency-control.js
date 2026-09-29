const SECRET_KEYS = new Set([
  "privateKey",
  "private_key",
  "seed",
  "mnemonic",
  "walletCredential",
  "wallet_credentials",
  "credential",
  "credentials",
  "hsmMaterial",
  "hsm_material",
  "signingMaterial",
  "signing_material",
  "password",
  "secret",
  "token",
  "authorization"
]);

export const PANIC_STATES = Object.freeze([
  "normal",
  "frozen",
  "sweep_requested",
  "sweep_executing",
  "sweep_completed",
  "sweep_failed"
]);

export const PANIC_ACTIONS = Object.freeze([
  "FREEZE",
  "REQUEST_SWEEP",
  "RESUME"
]);

export const EMERGENCY_ASSETS = Object.freeze(["BTC", "XMR"]);

function containsSecretKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretKey);
  return Object.entries(value).some(([key, child]) => SECRET_KEYS.has(key) || containsSecretKey(child));
}

export function assertPublicAdminPayload(payload) {
  if (containsSecretKey(payload)) {
    throw new Error("Secret-bearing fields are forbidden in the admin control plane");
  }
  return payload;
}

export function assertEmergencyAsset(assetCode) {
  if (!EMERGENCY_ASSETS.includes(assetCode)) {
    throw new TypeError("Emergency control supports only BTC and XMR");
  }
  return assetCode;
}

export function assertPanicTransition(currentState, action) {
  if (!PANIC_STATES.includes(currentState)) throw new TypeError("Invalid panic state");
  if (!PANIC_ACTIONS.includes(action)) throw new TypeError("Invalid panic action");

  const allowed = {
    normal: new Set(["FREEZE"]),
    frozen: new Set(["REQUEST_SWEEP", "RESUME"]),
    sweep_failed: new Set(["REQUEST_SWEEP", "RESUME"]),
    sweep_completed: new Set(["RESUME"]),
    sweep_requested: new Set(),
    sweep_executing: new Set()
  };

  if (!allowed[currentState].has(action)) {
    throw new Error(`Invalid panic transition: ${currentState} -> ${action}`);
  }

  return true;
}

export function buildSweepRequest({ operationId, destinations, reason }) {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(operationId)) {
    throw new TypeError("Invalid emergency operation id");
  }
  if (!Array.isArray(destinations) || destinations.length !== EMERGENCY_ASSETS.length) {
    throw new TypeError("Emergency sweep requires exactly one destination for BTC and XMR");
  }

  const seen = new Set();
  const normalized = destinations.map((entry) => {
    if (!entry || typeof entry !== "object") throw new TypeError("Invalid emergency destination");
    assertEmergencyAsset(entry.assetCode);
    if (seen.has(entry.assetCode)) throw new Error("Duplicate emergency asset destination");
    seen.add(entry.assetCode);
    if (typeof entry.destination !== "string" || entry.destination.length < 1 || entry.destination.length > 512) {
      throw new TypeError("Invalid emergency destination");
    }
    return Object.freeze({ assetCode: entry.assetCode, destination: entry.destination });
  });

  if (seen.size !== EMERGENCY_ASSETS.length) {
    throw new Error("Emergency sweep must cover BTC and XMR");
  }
  if (typeof reason !== "string" || reason.trim().length < 1 || reason.length > 2000) {
    throw new TypeError("Emergency reason is required");
  }

  return Object.freeze({
    operationId,
    reason: reason.trim(),
    destinations: Object.freeze(normalized)
  });
}
