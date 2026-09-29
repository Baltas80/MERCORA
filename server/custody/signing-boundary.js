import {
  assertExternalIdentifier,
  assertIdempotencyKey,
  assertNetwork,
  assertSupportedAsset
} from "./contracts.js";

export class SigningBoundary {
  constructor(assetCode) {
    this.asset = assertSupportedAsset(assetCode);
  }

  async signWithdrawal(request = {}) {
    void request;
    throw new Error(
      `Signing is intentionally unavailable in the application process for ${this.asset.code}; use an isolated wallet/signing service.`
    );
  }

  static validateSigningRequest(request = {}) {
    const asset = assertSupportedAsset(request.assetCode);
    return Object.freeze({
      assetCode: asset.code,
      network: assertNetwork(request.network),
      operationId: assertExternalIdentifier(request.operationId, "operationId"),
      idempotencyKey: assertIdempotencyKey(request.idempotencyKey)
    });
  }
}
