/**
 * The agent's budget as the program sees it. `rollPeriod` mirrors `roll` and `remainingOf`
 * mirrors `remaining_of` from the Bursar team contract, applied to Rein's Spender account.
 */

export type SpenderStatus = 'Active' | 'Paused' | 'Revoked';

export interface Policy {
  allowance: bigint;
  periodSecs: number;
  cap: bigint;
  maxPayments: number;
  expiresAt: number;
}

export interface SpenderView {
  status: SpenderStatus;
  policy: Policy;
  periodStart: number;
  spent: bigint;
  count: number;
}

export interface Rolled {
  periodStart: number;
  spent: bigint;
  count: number;
}

/** Rolls to the latest scheduled boundary at or before `now`, never to `now` itself. */
export function rollPeriod(sp: SpenderView, now: number): Rolled {
  const len = sp.policy.periodSecs;
  if (len > 0 && now >= sp.periodStart + len) {
    const periods = Math.floor((now - sp.periodStart) / len);
    return { periodStart: sp.periodStart + periods * len, spent: 0n, count: 0 };
  }
  return { periodStart: sp.periodStart, spent: sp.spent, count: sp.count };
}

/**
 * The most one payment can be right now and still settle inside the policy: the smaller of the
 * cap and what is left of the allowance, or zero when a stop applies. `teamPaused === null`
 * means the team could not be read, and an unknown input gives an unknown answer (null), not 0.
 */
export function remainingOf(sp: SpenderView, now: number, teamPaused: boolean | null): bigint | null {
  if (teamPaused === true || sp.status !== 'Active' || now >= sp.policy.expiresAt) return 0n;
  if (teamPaused === null) return null;
  const r = rollPeriod(sp, now);
  if (r.count >= sp.policy.maxPayments) return 0n;
  const left = sp.policy.allowance > r.spent ? sp.policy.allowance - r.spent : 0n;
  return left < sp.policy.cap ? left : sp.policy.cap;
}

/** What is left of this period's allowance, ignoring the cap. */
export function allowanceLeft(sp: SpenderView, now: number): bigint {
  const r = rollPeriod(sp, now);
  return sp.policy.allowance > r.spent ? sp.policy.allowance - r.spent : 0n;
}
