import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTENT_RE, isValidIntent, makeIntent } from '../src/intent.ts';

test('generated intents satisfy check_intent', () => {
  for (let i = 0; i < 2000; i++) {
    const intent = makeIntent();
    assert.ok(INTENT_RE.test(intent), intent);
    assert.ok(intent.length <= 32, intent);
  }
});

test('generated intents do not repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(makeIntent('ag', 1_700_000_000_000));
  assert.equal(seen.size, 5000);
});

test('is deterministic given the clock and randomness', () => {
  const zeros = (n: number) => new Uint8Array(n);
  assert.equal(makeIntent('ag', 0, zeros), 'ag-0-AAAAAAAAAAAA');
  const ff = (n: number) => new Uint8Array(n).fill(255);
  assert.equal(makeIntent('x', 36, ff), 'x-10-____________');
  assert.equal(makeIntent('', 35, zeros), 'z-AAAAAAAAAAAA');
});

test('rejects prefixes that would break the format', () => {
  for (const bad of ['a b', 'toolongprefix', 'é', 'a-b']) assert.throws(() => makeIntent(bad));
});

test('validates intents like the program does', () => {
  assert.ok(isValidIntent('a'));
  assert.ok(isValidIntent('A-z_0'));
  assert.ok(isValidIntent('x'.repeat(32)));
  for (const bad of ['', 'x'.repeat(33), 'has space', 'semi;colon', 'ünï', 'a.b']) assert.equal(isValidIntent(bad), false, bad);
});
