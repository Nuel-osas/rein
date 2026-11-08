import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStartedSteps, progressOf, type StepInput } from './get-started';
import type { Payment, Spender } from './rein';

const AI_CHAT = 'AiChatService1111111111111111111111111111111';
const OTHER = 'OtherService11111111111111111111111111111111';

const spender = (kind: Spender['kind'], status: Spender['status'] = 'active'): Spender => ({
  address: `S${kind}${status}`,
  team: 'T',
  authority: 'A',
  kind,
  label: kind === 'agent' ? 'Rein agent' : 'Ada',
  status,
  generation: 0,
  policy: { allowance: 300_000n, periodSecs: 86_400, cap: 50_000n, maxPayments: 20, expiresAt: 0 },
  services: [],
  periodStart: 0,
  spent: 0n,
  count: 0,
  addedAt: 0,
});

const payment = (kind: Payment['kind'], service: string, status: Payment['status']): Payment => ({
  address: `P${kind}${service}${status}`,
  team: 'T',
  spender: 'S',
  authority: 'A',
  kind,
  service,
  payeeToken: 'X',
  amount: 50_000n,
  intent: '',
  memo: '',
  generation: 0,
  reasons: 0,
  status,
  createdAt: 0,
  deadline: 0,
  decidedAt: 0,
  number: 0n,
});

const base: StepInput = {
  base: '',
  claimed: false,
  budgetSeen: false,
  agentAddress: null,
  spenders: [],
  payments: [],
  aiChatService: AI_CHAT,
};

const doneOf = (i: StepInput) => Object.fromEntries(getStartedSteps(i).map((s) => [s.id, s.done]));

describe('get started', () => {
  it('starts with only the team done', () => {
    assert.deepEqual(doneOf(base), { team: true, claim: false, budget: false, person: false, compute: false, approve: false });
    assert.deepEqual(progressOf(getStartedSteps(base)), { done: 1, total: 6, complete: false });
  });

  it('keeps unread state unknown, never done and never counted', () => {
    const steps = getStartedSteps({ ...base, claimed: null, budgetSeen: null, spenders: null, payments: null });
    assert.deepEqual(Object.fromEntries(steps.map((s) => [s.id, s.done])), { team: true, claim: null, budget: null, person: null, compute: null, approve: null });
    assert.equal(progressOf(steps).done, 1);
  });

  it('counts a person only when one is still on the team', () => {
    assert.equal(doneOf({ ...base, spenders: [spender('agent')] }).person, false);
    assert.equal(doneOf({ ...base, spenders: [spender('person', 'revoked')] }).person, false);
    assert.equal(doneOf({ ...base, spenders: [spender('person', 'paused')] }).person, true);
  });

  it('counts a compute run only for an agent paying ai-chat, in any status', () => {
    assert.equal(doneOf({ ...base, payments: [payment('person', AI_CHAT, 'paid')] }).compute, false);
    assert.equal(doneOf({ ...base, payments: [payment('agent', OTHER, 'paid')] }).compute, false);
    assert.equal(doneOf({ ...base, payments: [payment('agent', AI_CHAT, 'refused')] }).compute, true);
  });

  it('counts an approval only once a payment is settled', () => {
    assert.equal(doneOf({ ...base, payments: [payment('agent', AI_CHAT, 'pending'), payment('agent', AI_CHAT, 'paid')] }).approve, false);
    assert.equal(doneOf({ ...base, payments: [payment('person', OTHER, 'settled')] }).approve, true);
  });

  it('links the budget step to the Rein agent when there is one, else to Compute', () => {
    const at = (i: StepInput) => getStartedSteps(i).find((s) => s.id === 'budget')!.href;
    assert.equal(at({ ...base, base: '/app/T', agentAddress: 'Agent1' }), '/app/T/spenders/Agent1');
    assert.equal(at(base), '/compute');
  });

  it('is complete only when all six are known done', () => {
    const all: StepInput = {
      ...base,
      claimed: true,
      budgetSeen: true,
      spenders: [spender('person')],
      payments: [payment('agent', AI_CHAT, 'settled')],
    };
    assert.deepEqual(progressOf(getStartedSteps(all)), { done: 6, total: 6, complete: true });
    assert.equal(progressOf(getStartedSteps({ ...all, claimed: null })).complete, false);
  });
});
