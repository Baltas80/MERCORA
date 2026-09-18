# MERCORA Custody Architecture

## Purpose

Define the custody boundary for BTC, XMR and LTC while keeping marketplace services isolated from key material.

## Core rules

- The marketplace never handles private keys.
- The ledger is authoritative for user-accounting state; blockchain reconciliation is authoritative for on-chain balances.
- Every ledger mutation is append-only and attributable to an internal event ID.
- Emergency mode freezes deposits, withdrawals and balance-affecting operations before recovery begins.
- Emergency consolidation is asset-specific: BTC to BTC, XMR to XMR, LTC to LTC.
- No administrator may edit a user's balance directly.
- Hot-wallet exposure must be limited; treasury/cold-storage controls are separate.

## Logical model

`user -> custody account -> asset balance -> ledger entries -> on-chain reconciliation`

The ledger retains the mapping between user, asset, amount and transaction/event history even while assets are temporarily held in emergency wallets.

## Emergency state machine

`NORMAL -> FREEZE_REQUESTED -> FROZEN -> RECOVERY_AUTHORIZED -> RECOVERY_IN_PROGRESS -> RECONCILIATION -> NORMAL`

A failed recovery remains frozen until explicitly resolved.

## Required controls before production

- HSM/KMS-backed key protection where supported.
- Multi-party authorization for treasury and emergency operations.
- Offline/cold-storage procedures.
- Withdrawal policy engine and limits.
- Blockchain node redundancy and reconciliation.
- Immutable/security-audited audit events.
- Tested disaster recovery.
- Independent security review of wallet implementations.

This document contains no private keys, seeds, addresses or signing credentials.
