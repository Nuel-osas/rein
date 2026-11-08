// Runs the four claims Rein makes on a seeded cluster and prints a signature for each, so anyone
// can check them in an explorer. Each run uses fresh intents and a throwaway team, so it never
// spends the demo team's budget.
//
//   REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence
//
// 1. An agent with 0 SOL pays inside its policy, and it settles in one transaction.
// 2. An over-cap payment is filed as pending, and the owner's approval settles it in one transaction.
// 3. An unknown service is refused on chain (the failed transaction is mined and linked).
// 4. A payee the registry does not name is refused on chain.

import { BN } from '@coral-xyz/anchor';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAccount, getAccount, mintTo } from '@solana/spl-token';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminKey, client, cluster, decodeReasons, deployFile, explorer, fmt, key, pda, rpcUrl, U } from './lib';

type Line = { claim: string; result: string; signature: string };

async function main() {
  const conn = new Connection(rpcUrl(), 'confirmed');
  const d = JSON.parse(readFileSync(deployFile(), 'utf8'));
  const admin = adminKey();
  const sponsor = key('sponsor');
  const mintAuthority = key('mint-authority');
  const program = client(conn, sponsor);
  const mint = new PublicKey(d.mint);
  const svc = (id: string) => ({ address: pda.service(id), payeeToken: new PublicKey(d.services[id].payeeToken) });
  const lines: Line[] = [];
  const intent = (tag: string) => `ev-${tag}-${Date.now().toString(36)}`;

  // A throwaway team, owned by a fresh key the sponsor pays for.
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  if (cluster() === 'devnet') {
    // The owner signs approvals, so it needs a little SOL for its fee.
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: owner.publicKey, lamports: 0.005 * LAMPORTS_PER_SOL }));
    await sendAndConfirmTransaction(conn, tx, [admin]);
  } else {
    await conn.confirmTransaction(await conn.requestAirdrop(owner.publicKey, LAMPORTS_PER_SOL), 'confirmed');
  }
  await program.methods.createTeam('Evidence run').accounts({ payer: sponsor.publicKey, owner: owner.publicKey, mint }).signers([owner]).rpc();
  const team = pda.team(owner.publicKey);
  const vault = pda.vault(mint, team);
  await mintTo(conn, admin, mint, vault, mintAuthority, 50n * U);
  const now = Math.floor(Date.now() / 1000);
  await program.methods
    .addSpender(agent.publicKey, { agent: {} } as never, 'Evidence agent', {
      allowance: new BN((20n * U).toString()),
      periodSecs: 86400,
      cap: new BN((5n * U).toString()),
      maxPayments: 10,
      expiresAt: new BN(now + 86400),
    }, [svc('web-search').address, svc('gpu-hour').address])
    .accounts({ payer: sponsor.publicKey, owner: owner.publicKey })
    .signers([owner])
    .rpc();
  const spender = pda.spender(team, agent.publicKey);
  console.log(`team ${team.toBase58()}  agent ${agent.publicKey.toBase58()} (${await conn.getBalance(agent.publicKey)} lamports)`);

  const payIx = (service: { address: any; payeeToken: any }, amount: bigint, i: string) =>
    program.methods
      .pay(i, new BN(amount.toString()), 'evidence')
      .accounts({ payer: sponsor.publicKey, authority: agent.publicKey, team, service: service.address, vault, payeeToken: service.payeeToken } as never)
      .signers([agent]);
  const pay = (service: { address: any; payeeToken: any }, amount: bigint, i: string) => payIx(service, amount, i).rpc();
  // Preflight off, signed and sent by hand, so a refused payment is mined and keeps its signature.
  const payUnchecked = async (service: { address: any; payeeToken: any }, amount: bigint, i: string) => {
    const tx = await payIx(service, amount, i).transaction();
    tx.feePayer = sponsor.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(sponsor, agent);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, 'confirmed').catch(() => undefined);
    return sig;
  };

  // 1. Inside the policy.
  const i1 = intent('paid');
  const s1 = await pay(svc('web-search'), 400_000n, i1);
  const p1 = await program.account.payment.fetch(pda.payment(spender, i1));
  lines.push({ claim: 'Agent with 0 SOL pays 0.40 USDC for web-search inside its policy', result: Object.keys(p1.status)[0], signature: s1 });

  // 2. Over the cap: filed, then approved.
  const i2 = intent('over');
  const s2 = await pay(svc('gpu-hour'), 9n * U, i2);
  const payment2 = pda.payment(spender, i2);
  const p2 = await program.account.payment.fetch(payment2);
  lines.push({ claim: 'Agent asks for 9 USDC of GPU time, over its 5 USDC cap: filed for the owner', result: `${Object.keys(p2.status)[0]} (${decodeReasons(p2.reasons).join(', ')})`, signature: s2 });
  const asOwner = client(conn, owner);
  const s3 = await asOwner.methods
    .approve()
    .accounts({ owner: owner.publicKey, spender, service: svc('gpu-hour').address, vault, payeeToken: svc('gpu-hour').payeeToken, payment: payment2 } as never)
    .rpc();
  const p3 = await program.account.payment.fetch(payment2);
  lines.push({ claim: 'Owner approves; the 9 USDC settles in the same transaction', result: Object.keys(p3.status)[0], signature: s3 });

  // 3. Unknown service, mined.
  const fake = { address: pda.service('wallet-9xqe'), payeeToken: svc('web-search').payeeToken };
  lines.push({ claim: 'Prompt-injected agent tries a made-up service "wallet-9xqe"', ...(await minedFailure(conn, () => payUnchecked(fake, 1n * U, intent('fake')))) });

  // 4. Wrong payee, mined.
  const attacker = await createAccount(conn, admin, mint, Keypair.generate().publicKey);
  const wrong = { address: svc('web-search').address, payeeToken: attacker };
  lines.push({ claim: 'Agent passes an attacker token account as the web-search payee', ...(await minedFailure(conn, () => payUnchecked(wrong, 1n * U, intent('payee')))) });

  console.log(`vault now ${fmt((await getAccount(conn, vault)).amount)} USDC; agent still has ${await conn.getBalance(agent.publicKey)} lamports\n`);
  const md = [
    `# Evidence (${cluster()}, ${new Date().toISOString()})`,
    '',
    `Program \`${d.programId}\`. Throwaway team \`${team.toBase58()}\`. Agent \`${agent.publicKey.toBase58()}\` (0 SOL; the sponsor \`${sponsor.publicKey.toBase58()}\` pays fees and rent).`,
    '',
    '| Claim | Result | Transaction |',
    '|---|---|---|',
    ...lines.map((l) => `| ${l.claim} | ${l.result} | [${l.signature.slice(0, 10)}…](${explorer('tx', l.signature)}) |`),
    '',
    'Re-run: `REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence`',
    '',
  ].join('\n');
  for (const l of lines) console.log(`${l.result.padEnd(32)} ${l.claim}\n${' '.repeat(33)}${explorer('tx', l.signature)}`);
  if (cluster() === 'devnet') {
    mkdirSync(join(__dirname, '..', 'docs'), { recursive: true });
    writeFileSync(join(__dirname, '..', 'docs', 'EVIDENCE.md'), md);
    console.log('\nwrote docs/EVIDENCE.md');
  }
}

/** Sends with preflight off so the failure lands on chain, then reads the error from the mined tx. */
async function minedFailure(conn: Connection, send: () => Promise<string>): Promise<{ result: string; signature: string }> {
  const sig = await send();
  let tx = null;
  for (let i = 0; i < 20 && !tx; i++) {
    tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!tx) return { result: 'unknown (not found yet)', signature: sig };
  if (!tx.meta?.err) throw new Error(`expected a failed transaction, but ${sig} succeeded`);
  const log = (tx.meta.logMessages ?? []).find((l) => l.includes('AnchorError')) ?? JSON.stringify(tx.meta.err);
  const code = /Error Code: (\w+)/.exec(log)?.[1] ?? log;
  return { result: `refused on chain: ${code}`, signature: sig };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
