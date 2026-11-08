// Figures from one team's Payment accounts (the same getProgramAccounts read the team view polls:
// the Payment discriminator plus memcmp `team` at offset 8). Counts and sums only; money stays in
// bigint base units and is formatted at the edge. Payment accounts are never closed by the program,
// so the list is the team's whole history.

import type {Payment} from './rein';

/** A payment's outcome as the app words it. A pending payment past its deadline can no longer be approved. */
export type Outcome = 'paid' | 'settled' | 'waiting' | 'expired' | 'declined' | 'refused' | 'cancelled';

export const OUTCOMES: Outcome[] = ['paid', 'settled', 'waiting', 'expired', 'declined', 'refused', 'cancelled'];

export const OUTCOME_TEXT: Record<Outcome, string> = {
  paid: 'Paid inside the policy',
  settled: 'Approved by the owner and settled',
  waiting: 'Waiting for the owner',
  expired: 'Expired unanswered',
  declined: 'Declined by the owner',
  refused: 'Refused at approval',
  cancelled: 'Cancelled',
};

export function outcomeOf(p: Payment, now: number): Outcome {
  if (p.status === 'pending') return now < p.deadline ? 'waiting' : 'expired';
  return p.status;
}

/** USDC left the vault: paid inside the policy, or approved and settled. */
export function moved(p: Payment): boolean {
  return p.status === 'paid' || p.status === 'settled';
}

export type Summary = {
  count: number;
  counts: Record<Outcome, number>;
  /** Sum of what each outcome asked for. */
  amounts: Record<Outcome, bigint>;
  /** USDC that left the vault. */
  paid: bigint;
  paidCount: number;
  /** USDC asked for by payments still waiting on the owner. */
  held: bigint;
  first: number | null;
  last: number | null;
};

export function summarize(payments: Payment[], now: number): Summary {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const amounts = Object.fromEntries(OUTCOMES.map((o) => [o, 0n])) as Record<Outcome, bigint>;
  let paid = 0n;
  let paidCount = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const p of payments) {
    const o = outcomeOf(p, now);
    counts[o] += 1;
    amounts[o] += p.amount;
    if (moved(p)) {
      paid += p.amount;
      paidCount += 1;
    }
    if (first === null || p.createdAt < first) first = p.createdAt;
    if (last === null || p.createdAt > last) last = p.createdAt;
  }
  return {count: payments.length, counts, amounts, paid, paidCount, held: amounts.waiting, first, last};
}

export type Group = {key: string; count: number; paidCount: number; paid: bigint; waiting: number; refusedOrDeclined: number};

/** Payments grouped by a key (spender or service account), largest USDC paid first. */
export function groupBy(payments: Payment[], keyOf: (p: Payment) => string, now: number): Group[] {
  const m = new Map<string, Group>();
  for (const p of payments) {
    const k = keyOf(p);
    const g = m.get(k) ?? {key: k, count: 0, paidCount: 0, paid: 0n, waiting: 0, refusedOrDeclined: 0};
    g.count += 1;
    const o = outcomeOf(p, now);
    if (moved(p)) {
      g.paidCount += 1;
      g.paid += p.amount;
    }
    if (o === 'waiting') g.waiting += 1;
    if (o === 'declined' || o === 'refused') g.refusedOrDeclined += 1;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => (b.paid > a.paid ? 1 : b.paid < a.paid ? -1 : b.count - a.count));
}

export type Bucket = {start: number; end: number; count: number; paidCount: number; paid: bigint};
export type Series = {unit: 'hour' | 'day'; buckets: Bucket[]; /** filed before the first bucket, so not drawn */ earlier: number};

const HOUR = 3600;
const DAY = 86400;

/**
 * Payments filed per hour (history under two days) or per day (up to the last 30), in UTC, ending
 * with the bucket that holds `now`. Empty buckets are real zeros: the list was read in full.
 */
export function series(payments: Payment[], now: number): Series {
  const first = payments.reduce<number | null>((a, p) => (a === null || p.createdAt < a ? p.createdAt : a), null);
  const span = first === null ? 0 : Math.max(0, now - first);
  const unit: 'hour' | 'day' = span <= 2 * DAY ? 'hour' : 'day';
  const size = unit === 'hour' ? HOUR : DAY;
  const n = unit === 'hour' ? Math.min(48, Math.max(12, Math.ceil(span / HOUR) + 1)) : Math.min(30, Math.max(7, Math.ceil(span / DAY) + 1));
  const lastStart = Math.floor(now / size) * size;
  const firstStart = lastStart - (n - 1) * size;
  const buckets: Bucket[] = Array.from({length: n}, (_, i) => ({start: firstStart + i * size, end: firstStart + (i + 1) * size, count: 0, paidCount: 0, paid: 0n}));
  let earlier = 0;
  for (const p of payments) {
    const i = Math.floor((p.createdAt - firstStart) / size);
    if (i < 0) {
      earlier += 1;
      continue;
    }
    const b = buckets[Math.min(i, n - 1)];
    b.count += 1;
    if (moved(p)) {
      b.paidCount += 1;
      b.paid += p.amount;
    }
  }
  return {unit, buckets, earlier};
}

/** a / b as a whole percent, from bigints, without floating the money. Null when b is zero. */
export function percent(a: bigint, b: bigint): number | null {
  if (b <= 0n) return null;
  return Number((a * 100n + b / 2n) / b);
}
