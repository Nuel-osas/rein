import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeReasons, REASON_BITS } from '../src/reasons.ts';

test('bits match the program constants', () => {
  assert.deepEqual(REASON_BITS, { service_not_allowed: 1, over_cap: 2, over_allowance: 4, over_payment_count: 8 });
});

test('decodes each reason and combinations', () => {
  assert.deepEqual(decodeReasons(0), []);
  assert.deepEqual(decodeReasons(1), ['service_not_allowed']);
  assert.deepEqual(decodeReasons(2), ['over_cap']);
  assert.deepEqual(decodeReasons(4), ['over_allowance']);
  assert.deepEqual(decodeReasons(8), ['over_payment_count']);
  assert.deepEqual(decodeReasons(3), ['service_not_allowed', 'over_cap']);
  assert.deepEqual(decodeReasons(15), ['service_not_allowed', 'over_cap', 'over_allowance', 'over_payment_count']);
});

test('keeps bits the contract does not define instead of dropping them', () => {
  assert.deepEqual(decodeReasons(16), ['unknown_bit_16']);
  assert.deepEqual(decodeReasons(0x82), ['over_cap', 'unknown_bit_128']);
});

test('rejects values that are not a u8', () => {
  for (const bad of [-1, 256, 1.5, Number.NaN]) assert.throws(() => decodeReasons(bad), RangeError);
});
