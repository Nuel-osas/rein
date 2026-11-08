import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUsdc, parseUsdc, U64_MAX } from '../src/amount.ts';

test('parses decimal USDC strings into base units', () => {
  assert.equal(parseUsdc('0.40'), 400_000n);
  assert.equal(parseUsdc('2'), 2_000_000n);
  assert.equal(parseUsdc('1.5'), 1_500_000n);
  assert.equal(parseUsdc('0.000001'), 1n);
  assert.equal(parseUsdc(' 12.345678 '), 12_345_678n);
  assert.equal(parseUsdc('18446744073709.551615'), U64_MAX);
});

test('accepts a JS number only through its decimal form', () => {
  assert.equal(parseUsdc(0.4), 400_000n);
  assert.equal(parseUsdc(3), 3_000_000n);
  assert.throws(() => parseUsdc(1e-7), /not a positive decimal/);
  assert.throws(() => parseUsdc(Number.NaN));
});

test('rejects more than 6 decimals', () => {
  assert.throws(() => parseUsdc('0.0000001'), /more than 6 decimals/);
  assert.throws(() => parseUsdc('1.1234567'), /more than 6 decimals/);
});

test('rejects zero, negatives and garbage', () => {
  for (const bad of ['0', '0.0', '0.000000', '-1', '-0.5', '+1', '', ' ', '.5', '5.', '1e3', '1,5', '$1', '1 USDC', 'fifty', '0x10', '1.2.3', 'NaN', 'Infinity']) {
    assert.throws(() => parseUsdc(bad), Error, `should reject ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, undefined, true, {}, [], 10n]) {
    assert.throws(() => parseUsdc(bad as unknown), Error, `should reject ${String(bad)}`);
  }
});

test('rejects amounts above u64', () => {
  assert.throws(() => parseUsdc('18446744073709.551616'), /larger than the chain/);
  assert.throws(() => parseUsdc('99999999999999999999'), /larger than the chain/);
  assert.throws(() => parseUsdc('123456789012345678901'), /not a positive decimal/);
});

test('formats base units for display', () => {
  assert.equal(formatUsdc(400_000n), '0.40');
  assert.equal(formatUsdc(2_000_000n), '2.00');
  assert.equal(formatUsdc(1_234_567n), '1.234567');
  assert.equal(formatUsdc(0n), '0.00');
  assert.equal(formatUsdc(-1_500_000n), '-1.50');
  assert.equal(parseUsdc(formatUsdc(12_345_678n)), 12_345_678n);
});
