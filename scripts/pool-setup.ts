// The claim pool: a plain keypair whose test-USDC token account holds what /api/claim hands out,
// 0.30 once per Google account. Safe to re-run: it creates the key and the token account only when
// they are missing, and mints the 6 USDC (20 claims) only into an account that has never been funded.
// A drained pool stays drained unless you pass --refill, so the pool's balance stays a hard cap
// (the route's CLAIM_TOTAL_CAP, default 16, is the softer one).
//
//   REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm pool:setup [--refill]
//
// Keys: the pool key is ~/.config/rein/pool.json (created here, mode 600, never in the repo); the
// mint authority is ~/.config/rein/mint-authority.json; the admin (who pays the token account's rent
// and the fees) is the Solana CLI wallet. The pool key needs no SOL: the sponsor pays each claim's fee.

import { readFileSync, writeFileSync } from 'node:fs';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { adminKey, client, cluster, deployFile, explorer, fmt, key, pda, rpcUrl, U } from './lib';

const TARGET = 6n * U; // 6 test USDC = 20 claims of 0.30
const CLAIM = 300_000n; // 0.30 test USDC

async function balanceOf(conn: Connection, account: PublicKey): Promise<bigint | null> {
  try {
    const r = await conn.getTokenAccountBalance(account, 'confirmed');
    return /^\d+$/.test(r.value.amount) ? BigInt(r.value.amount) : null;
  } catch {
    return null;
  }
}

async function main() {
  const refill = process.argv.includes('--refill');
  const conn = new Connection(rpcUrl(), 'confirmed');
  const admin = adminKey();
  const mintAuthority = key('mint-authority');
  const pool = key('pool');
  const program = client(conn, admin);
  console.log(`cluster ${cluster()} at ${rpcUrl()}`);
  console.log(`admin   ${admin.publicKey.toBase58()}  ${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`pool    ${pool.publicKey.toBase58()}`);

  // The token is the registry's, read from the Config account, never assumed.
  const config = await program.account.config.fetch(pda.config());
  const mint = config.mint as PublicKey;
  const deployed = JSON.parse(readFileSync(deployFile(), 'utf8')) as Record<string, unknown>;
  if (deployed.mint && deployed.mint !== mint.toBase58()) throw new Error(`Config.mint ${mint.toBase58()} differs from deploy file ${deployed.mint}`);
  if (deployed.mintAuthority && deployed.mintAuthority !== mintAuthority.publicKey.toBase58()) {
    throw new Error('~/.config/rein/mint-authority.json is not the mint authority recorded in the deploy file');
  }

  const token = getAssociatedTokenAddressSync(mint, pool.publicKey, false);
  console.log(`token   ${token.toBase58()}`);
  const sigs: Record<string, string> = {};

  let account = await getAccount(conn, token, 'confirmed').catch(() => null);
  if (!account) {
    const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, token, pool.publicKey, mint));
    sigs.createTokenAccount = await sendAndConfirmTransaction(conn, tx, [admin], { commitment: 'confirmed' });
    console.log(`created the pool's token account: ${explorer('tx', sigs.createTokenAccount)}`);
    account = await getAccount(conn, token, 'confirmed');
  }
  if (!account.owner.equals(pool.publicKey) || !account.mint.equals(mint)) throw new Error('the pool token account has the wrong owner or mint');

  const before = await balanceOf(conn, token);
  if (before === null) throw new Error('could not read the pool balance; nothing was minted');
  const prior = (deployed.pool as { fundedSignature?: string } | undefined)?.fundedSignature;
  const neverFunded = before === 0n && !prior;
  if ((neverFunded || refill) && before < TARGET) {
    const amount = TARGET - before;
    const tx = new Transaction().add(createMintToInstruction(mint, token, mintAuthority.publicKey, amount));
    tx.feePayer = admin.publicKey;
    sigs.fund = await sendAndConfirmTransaction(conn, tx, [admin, mintAuthority], { commitment: 'confirmed' });
    console.log(`minted ${fmt(amount)} test USDC into the pool: ${explorer('tx', sigs.fund)}`);
  } else {
    console.log(before >= TARGET ? 'already funded' : 'funded before and drawn down; pass --refill to top it up to 6');
  }
  const after = await balanceOf(conn, token);
  console.log(`balance ${fmt(after)} test USDC (${after === null ? '—' : (after / CLAIM).toString()} claims left)`);

  const previous = (deployed.pool ?? {}) as Record<string, unknown>;
  deployed.pool = {
    ...previous,
    authority: pool.publicKey.toBase58(),
    token: token.toBase58(),
    claim: fmt(CLAIM),
    target: fmt(TARGET),
    ...(sigs.createTokenAccount ? { createdSignature: sigs.createTokenAccount } : {}),
    ...(sigs.fund ? { fundedSignature: sigs.fund, fundedAmount: fmt(TARGET - before) } : {}),
    balanceAtSetup: after === null ? null : fmt(after),
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(deployFile(), JSON.stringify(deployed, null, 2) + '\n');
  console.log(`wrote ${deployFile()}`);
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e));
  process.exit(1);
});
