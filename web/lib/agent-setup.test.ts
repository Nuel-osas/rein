import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vaultShortfall } from './agent-setup';
import { usdc } from './chain';

test('vaultShortfall blocks a run the vault cannot cover, and only that', () => {
  // A new team after its one claim: 0.30 in the vault.
  assert.equal(vaultShortfall(10_000n, 300_000n, 'chat', usdc), null);
  assert.equal(vaultShortfall(300_000n, 300_000n, 'chat', usdc), null);
  const video = vaultShortfall(430_000n, 300_000n, 'video', usdc);
  assert.match(String(video), /costs \$0\.43 .* holds \$0\.30, so it cannot be paid/);
  assert.match(String(video), /more than one claim/);
  assert.doesNotMatch(String(vaultShortfall(20_000n, 10_000n, 'image', usdc)), /claim/);
  assert.match(String(vaultShortfall(10_000n, 0n, 'chat', usdc)), /vault is empty\. Claim/);
});

test('vaultShortfall never blocks on an unknown price or balance', () => {
  assert.equal(vaultShortfall(null, 0n, 'video', usdc), null);
  assert.equal(vaultShortfall(430_000n, null, 'video', usdc), null);
});
