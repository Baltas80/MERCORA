import {
  assertExternalIdentifier,
  assertNetwork,
  assertSupportedAsset,
  normalizeObservation
} from "./contracts.js";

export class BlockchainObserver {
  constructor(assetCode) {
    this.asset = assertSupportedAsset(assetCode);
  }

  async getTransaction(request = {}) {
    void request;
    throw new Error(
      `Blockchain observer is not configured for ${this.asset.code}; production chain access must use an isolated observer service.`
    );
  }

  async getNetworkTip(request = {}) {
    void request;
    throw new Error(
      `Blockchain observer is not configured for ${this.asset.code}; production chain access must use an isolated observer service.`
    );
  }

  static validateTransactionReference(reference = {}) {
    return Object.freeze({
      network: assertNetwork(reference.network),
      transactionId: assertExternalIdentifier(reference.transactionId, "transactionId")
    });
  }

  static normalizeObservation(input) {
    return normalizeObservation(input);
  }
}
