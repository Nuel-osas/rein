import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ReinChain } from '../src/chain.ts';
import { coder, IDL, IDL_PROGRAM_ID } from '../src/idl.ts';
import { buildPayIx, clampMemo } from '../src/pay.ts';

const chain = new ReinChain(null as never);
const pk = () => Keypair.generate().publicKey;

test('PDAs use the program seeds', () => {
  const owner = pk(), authority = pk();
  const find = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, IDL_PROGRAM_ID)[0];
  assert.ok(chain.configPda().equals(find([Buffer.from('config')])));
  assert.ok(chain.servicePda('ai-chat').address.equals(find([Buffer.from('service'), Buffer.from('ai-chat')])));
  const team = chain.teamPda(owner);
  assert.ok(team.equals(find([Buffer.from('team'), owner.toBuffer()])));
  const spender = chain.spenderPda(team, authority);
  assert.ok(spender.equals(find([Buffer.from('spender'), team.toBuffer(), authority.toBuffer()])));
  assert.ok(chain.paymentPda(spender, 'ag-1').equals(find([Buffer.from('payment'), spender.toBuffer(), Buffer.from('ag-1')])));
});

test('an id too long for a seed gets a stand-in address that can never be registered', () => {
  const long = '9xQeTq4JkzV7cA2mNPw8dRt5LbYhE3sGfUoX6iWnZpK1';
  const a = chain.servicePda(long);
  assert.equal(a.placeholder, true);
  assert.ok(a.address.equals(chain.servicePda(long).address), 'stable');
  assert.equal(chain.servicePda('wallet-9xqe').placeholder, false);
  assert.equal(chain.servicePda('x'.repeat(32)).placeholder, false);
  assert.equal(chain.servicePda('').placeholder, true);
});

test('the vault is the team ATA for the mint', () => {
  // Seeded localnet values (deploy/localnet.json): team EWuQ…, mint 2MzD…, vault FT8E….
  const vault = ReinChain.vaultAddress(
    new PublicKey('EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5'),
    new PublicKey('2MzDtBc5GCe7mQwygagWhiH4K6d157qegbKHhAAr6HfQ'),
  );
  assert.equal(vault.toBase58(), 'FT8EQ2kYhFPqQ1FeSFUXr6jfRgUaie6WaUvLHLuxCGVt');
});

test('Payment and Spender keep team at offset 8 and decode back', async () => {
  const team = pk(), spender = pk(), authority = pk(), service = pk(), payee = pk();
  const payment = await coder.accounts.encode('Payment', {
    team, spender, authority, kind: { Agent: {} }, service, payee_token: payee, amount: new BN(12_000_000),
    intent: 'ag-x', memo: 'premium', generation: 0, reasons: 3, status: { Pending: {} },
    created_at: new BN(1_800_000_000), deadline: new BN(1_800_086_400), decided_at: new BN(0), number: new BN(4), bump: 255,
  });
  assert.ok(new PublicKey(payment.subarray(8, 40)).equals(team));
  const p = ReinChain.decodePayment(pk(), payment);
  assert.equal(p.status, 'Pending');
  assert.equal(p.amount, 12_000_000n);
  assert.equal(p.reasons, 3);
  assert.equal(p.deadline, 1_800_086_400);

  const sp = await coder.accounts.encode('Spender', {
    team, authority, kind: { Agent: {} }, label: 'Research agent', status: { Active: {} }, generation: 0,
    policy: { allowance: new BN(20_000_000), period_secs: 86400, cap: new BN(5_000_000), max_payments: 10, expires_at: new BN(1_802_592_000) },
    services: [service], period_start: new BN(1_800_000_000), spent: new BN(400_000), count: 1, added_at: new BN(1_800_000_000), bump: 254,
  });
  assert.ok(new PublicKey(sp.subarray(8, 40)).equals(team));
  const s = ReinChain.decodeSpender(pk(), sp);
  assert.equal(s.status, 'Active');
  assert.equal(s.policy.cap, 5_000_000n);
  assert.equal(s.spent, 400_000n);
  assert.ok(s.services[0]!.equals(service));
});

test('pay instruction lists accounts in IDL order with the IDL flags', () => {
  const k = { payer: pk(), authority: pk(), team: pk(), spender: pk(), service: pk(), vault: pk(), payeeToken: pk(), payment: pk() };
  const ix = buildPayIx({ programId: IDL_PROGRAM_ID, ...k, intent: 'ag-1', amount: 400_000n, memo: 'm' });
  const spec = IDL.instructions.find((i) => i.name === 'pay')!;
  assert.equal(ix.keys.length, spec.accounts.length);
  spec.accounts.forEach((a, i) => {
    const acc = a as { name: string; writable?: boolean; signer?: boolean; address?: string };
    assert.equal(ix.keys[i]!.isWritable, !!acc.writable, `${acc.name} writable`);
    assert.equal(ix.keys[i]!.isSigner, !!acc.signer, `${acc.name} signer`);
    if (acc.address) assert.equal(ix.keys[i]!.pubkey.toBase58(), acc.address, acc.name);
  });
  const decoded = coder.instruction.decode(ix.data) as { name: string; data: { intent: string; amount: BN; memo: string } };
  assert.equal(decoded.name, 'pay');
  assert.equal(decoded.data.intent, 'ag-1');
  assert.equal(decoded.data.amount.toString(), '400000');
});

test('memos are cut to 64 bytes on a character boundary', () => {
  assert.equal(clampMemo('short'), 'short');
  assert.equal(Buffer.byteLength(clampMemo('x'.repeat(100))), 64);
  const cut = clampMemo('é'.repeat(40));
  assert.equal(Buffer.byteLength(cut), 64);
  assert.equal(cut, 'é'.repeat(32));
});
