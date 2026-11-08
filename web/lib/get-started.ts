// "Get started" on Home: the six first steps of a new team, each ticked from real state, never
// from a guess. A step whose state could not be read is `null` (unknown, shown as "—"), so it is
// neither ticked nor counted as done. Browser-safe: no keys, no chain reads here.
//
// The flags kept in this browser (the tour seen, the agent's budget opened, the card hidden) go
// through `readFlag` / `writeFlag`, which never throw: storage that throws reads as unknown.

import type { Payment, Spender } from './rein';

/** Set once the first-visit tour has started in this browser. */
export const TOUR_DONE_KEY = 'rein.tour.v1.done';
/** Set when the owner opened an agent's spender page or its Edit policy page, per team. */
export const budgetSeenKey = (team: string) => `rein.getstarted.v1.budget.${team}`;
/** Set when the owner pressed Hide on the card, per team. */
export const hiddenKey = (team: string) => `rein.getstarted.v1.hidden.${team}`;

/** true / false when storage answered, null when it threw (private mode, blocked storage). */
export function readFlag(key: string): boolean | null {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return null;
  }
}

/** false when storage threw; the caller keeps its own in-memory state either way. */
export function writeFlag(key: string): boolean {
  try {
    window.localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export type StepId = 'team' | 'claim' | 'budget' | 'person' | 'compute' | 'approve';

export type Step = { id: StepId; label: string; href: string | null; done: boolean | null };

export type StepInput = {
  /** Link prefix of the team: "" for one's own team, /app/<team> otherwise. */
  base: string;
  /** The claim card's own "claimed" state: true, false, or null while unknown. */
  claimed: boolean | null;
  /** The budget flag from this browser: null when storage could not be read. */
  budgetSeen: boolean | null;
  /** The Rein agent's spender account, when there is one, for the budget link. */
  agentAddress: string | null;
  spenders: Spender[] | null;
  payments: Payment[] | null;
  /** The ai-chat service's registry address (pda.service("ai-chat")). */
  aiChatService: string;
};

/** The six steps in order. Pure, so the rules are tested without a browser. */
export function getStartedSteps(i: StepInput): Step[] {
  const people = i.spenders === null ? null : i.spenders.some((s) => s.kind === 'person' && s.status !== 'revoked');
  const ran = i.payments === null ? null : i.payments.some((p) => p.kind === 'agent' && p.service === i.aiChatService);
  const approved = i.payments === null ? null : i.payments.some((p) => p.status === 'settled');
  return [
    { id: 'team', label: 'Create your team', href: null, done: true },
    { id: 'claim', label: 'Claim your $0.30', href: '#claim', done: i.claimed },
    {
      id: 'budget',
      label: "Review your agent's budget",
      href: i.agentAddress ? `${i.base}/spenders/${i.agentAddress}` : `${i.base}/compute`,
      done: i.budgetSeen,
    },
    { id: 'person', label: 'Add a person', href: `${i.base}/spenders/new`, done: people },
    { id: 'compute', label: 'Ask the agent for a compute run', href: `${i.base}/compute`, done: ran },
    { id: 'approve', label: 'Approve a payment', href: `${i.base}/approvals`, done: approved },
  ];
}

/** How many are known done, and whether every one is. An unknown step is never counted. */
export function progressOf(steps: Step[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done === true).length;
  return { done, total: steps.length, complete: done === steps.length };
}
