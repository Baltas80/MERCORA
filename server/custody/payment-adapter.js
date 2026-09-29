import {
  assertAtomicAmount,
  assertExternalIdentifier,
  assertIdempotencyKey,
  assertNetwork,
  assertSupportedAsset
} from "./contracts.js";

export class PaymentAdapter {
  constructor(assetCode) {
    this.asset = assertSupportedAsset(assetCode);
  }

  async createDepositAddress(request = {}) {
    this.#unsupported("createDepositAddress", request);
  }

  async getPaymentStatus(request = {}) {
    this.#unsupported("getPaymentStatus", request);
  }

  async requestWithdrawal(request = {}) {
    this.#unsupported("requestWithdrawal", request);
  }

  #unsupported(operation, request) {
    void request;
    throw new Error(
      `Payment adapter operation ${operation} is not implemented for ${this.asset.code}; configure an isolated production adapter.`
    );
  }

  static validateDepositRequest(request = {}) {
    assertNetwork(request.network);
    assertIdempotencyKey(request.idempotencyKey);
    return Object.freeze({
      accountId: assertExternalIdentifier(request.accountId, "accountId"),
      network: request.network,
      idempotencyKey: request.idempotencyKey
    });
  }

  static validatePaymentStatusRequest(request = {}) {
    assertNetwork(request.network);
    return Object.freeze({
      network: request.network,
      transactionId: assertExternalIdentifier(request.transactionId, "transactionId")
    });
  }

  static validateWithdrawalRequest(request = {}) {
    assertNetwork(request.network);
    assertIdempotencyKey(request.idempotencyKey);
    assertAtomicAmount(request.amountAtomic);

    return Object.freeze({
      accountId: assertExternalIdentifier(request.accountId, "accountId"),
      network: request.network,
      destination: assertExternalIdentifier(request.destination, "destination"),
      amountAtomic: BigInt(request.amountAtomic),
      idempotencyKey: request.idempotencyKey
    });
  }
}
