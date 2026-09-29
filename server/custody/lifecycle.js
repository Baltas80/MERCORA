import { OBSERVATION_STATES, WITHDRAWAL_STATES } from "./contracts.js";

const WITHDRAWAL_TRANSITIONS = Object.freeze({
  requested: Object.freeze(["approved", "rejected", "cancelled"]),
  approved: Object.freeze(["broadcast", "rejected", "cancelled"]),
  broadcast: Object.freeze(["confirmed"]),
  confirmed: Object.freeze([]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([])
});

const OBSERVATION_TRANSITIONS = Object.freeze({
  observed: Object.freeze(["confirming", "confirmed"]),
  confirming: Object.freeze(["confirmed"]),
  confirmed: Object.freeze([])
});

export function canTransitionWithdrawal(from, to) {
  return WITHDRAWAL_STATES.includes(from) &&
    WITHDRAWAL_STATES.includes(to) &&
    WITHDRAWAL_TRANSITIONS[from].includes(to);
}

export function transitionWithdrawal(from, to) {
  if (!canTransitionWithdrawal(from, to)) {
    throw new Error(`Invalid withdrawal transition: ${from} -> ${to}`);
  }
  return to;
}

export function canTransitionObservation(from, to) {
  return OBSERVATION_STATES.includes(from) &&
    OBSERVATION_STATES.includes(to) &&
    OBSERVATION_TRANSITIONS[from].includes(to);
}

export function transitionObservation(from, to) {
  if (!canTransitionObservation(from, to)) {
    throw new Error(`Invalid observation transition: ${from} -> ${to}`);
  }
  return to;
}
