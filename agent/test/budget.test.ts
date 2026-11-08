import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowanceLeft, remainingOf, rollPeriod, type SpenderView } from '../src/budget.ts';

const U = 1_000_000n;
const DAY = 86_400;
const T0 = 1_800_000_000;

function sp(over: Partial<SpenderView> = {}, policy: Partial<SpenderView['policy']> = {}): SpenderView {
  return {
    status: 'Active',
    periodStart: T0,
    spent: 0n,
    count: 0,
    ...over,
    policy: { allowance: 20n * U, periodSecs: DAY, cap: 5n * U, maxPayments: 10, expiresAt: T0 + 30 * DAY, ...policy },
  };
}

test('fresh spender: remaining is the cap', () => {
  assert.equal(remainingOf(sp(), T0 + 10, false), 5n * U);
});

test('remaining is what is left of the allowance when that is below the cap', () => {
  assert.equal(remainingOf(sp({ spent: 17n * U, count: 4 }), T0 + 10, false), 3n * U);
  assert.equal(remainingOf(sp({ spent: 20n * U, count: 4 }), T0 + 10, false), 0n);
  assert.equal(remainingOf(sp({ spent: 25n * U, count: 4 }), T0 + 10, false), 0n, 'overspent after an approval saturates at 0');
});

test('payment count used up: remaining is 0', () => {
  assert.equal(remainingOf(sp({ count: 10 }), T0 + 10, false), 0n);
});

test('stops make remaining 0', () => {
  assert.equal(remainingOf(sp(), T0 + 10, true), 0n, 'team paused');
  assert.equal(remainingOf(sp({ status: 'Paused' }), T0 + 10, false), 0n);
  assert.equal(remainingOf(sp({ status: 'Revoked' }), T0 + 10, null), 0n, 'revoked is 0 even if the team is unknown');
  assert.equal(remainingOf(sp(), T0 + 30 * DAY, false), 0n, 'expiry is exclusive like the program');
  assert.equal(remainingOf(sp(), T0 + 30 * DAY - 1, false), 5n * U);
});

test('an unread team makes remaining unknown, not 0', () => {
  assert.equal(remainingOf(sp(), T0 + 10, null), null);
});

test('the period rolls on schedule from the grant, never to now', () => {
  const s = sp({ spent: 18n * U, count: 10 });
  assert.deepEqual(rollPeriod(s, T0 + DAY - 1), { periodStart: T0, spent: 18n * U, count: 10 });
  assert.deepEqual(rollPeriod(s, T0 + DAY), { periodStart: T0 + DAY, spent: 0n, count: 0 });
  assert.deepEqual(rollPeriod(s, T0 + 3 * DAY + 5), { periodStart: T0 + 3 * DAY, spent: 0n, count: 0 });
  assert.equal(remainingOf(s, T0 + DAY - 1, false), 0n);
  assert.equal(remainingOf(s, T0 + DAY, false), 5n * U);
  assert.equal(allowanceLeft(s, T0 + 10), 2n * U);
  assert.equal(allowanceLeft(s, T0 + DAY), 20n * U);
});
