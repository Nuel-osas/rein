// Seeds a cluster with everything the demo needs, and is safe to re-run:
// a test USDC mint, the config, a service registry, the demo team "Acme Research",
// a funded vault, a research agent and one person. Writes public addresses to deploy/<cluster>.json.
//
//   REIN_CLUSTER=localnet REIN_RPC_URL=http://127.0.0.1:8999 pnpm seed
//   REIN_CLUSTER=devnet   REIN_RPC_URL=https://api.devnet.solana.com pnpm seed

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BN } from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import { adminKey, client, cluster, deployFile, fmt, key, pda, rpcUrl, U, usdc } from './lib';

export const SERVICES = [
  { id: 'web-search', label: 'Web search API, 1k queries', price: '0.40' },
  { id: 'llm-inference', label: 'LLM inference, 1M tokens', price: '2' },
  { id: 'market-data', label: 'Market data feed, 1 day', price: '1.50' },
  { id: 'gpu-hour', label: 'GPU hour (H100)', price: '3' },
  { id: 'premium-dataset', label: 'Premium dataset licence', price: '12' },
] as const;

const DAY = 24 * 3600;

async function main() {
  const conn = new Connection(rpcUrl(), 'confirmed');
  const admin = adminKey();
  const mintAuthority = key('mint-authority');
  const sponsor = key('sponsor');
  const owner = key('demo-owner');
  const agent = key('demo-agent');
  const person = key('demo-person');
  const program = client(conn, admin);
  console.log(`cluster ${cluster()} at ${rpcUrl()}`);
  console.log(`admin   ${admin.publicKey.toBase58()}  ${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // SOL: localnet airdrops; devnet moves a little from the admin wallet.
  const want: [Keypair, number][] = [
    [sponsor, 0.3],
    [owner, 0.02],
  ];
  if (cluster() === 'localnet') {
    for (const kp of [admin, ...want.map(([k]) => k)]) {
      if ((await conn.getBalance(kp.publicKey)) < 2 * LAMPORTS_PER_SOL) {
        const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig, 'confirmed');
      }
    }
  } else {
    for (const [kp, sol] of want) {
      const have = await conn.getBalance(kp.publicKey);
      const target = Math.round(sol * LAMPORTS_PER_SOL);
      if (have < target / 2) {
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: target - have }),
        );
        await sendAndConfirmTransaction(conn, tx, [admin]);
      }
    }
  }

  // Mint: reuse the one recorded for this cluster if it still exists.
  const file = deployFile();
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let mint: PublicKey | null = prior.mint ? new PublicKey(prior.mint) : null;
  if (mint && !(await conn.getAccountInfo(mint))) mint = null;
  if (!mint) mint = await createMint(conn, admin, mintAuthority.publicKey, null, 6);
  console.log(`mint    ${mint.toBase58()} (test USDC, 6 decimals)`);

  const config = pda.config();
  if (!(await conn.getAccountInfo(config))) {
    await program.methods.initConfig().accounts({ admin: admin.publicKey, mint }).rpc();
  }
  const cfg = await program.account.config.fetch(config);
  if (!cfg.mint.equals(mint)) throw new Error(`config already points at mint ${cfg.mint.toBase58()}`);

  const services: Record<string, { address: string; payee: string; payeeToken: string; price: string }> = {};
  for (const s of SERVICES) {
    const payee = key(`payee-${s.id}`);
    const payeeToken = await getOrCreateAssociatedTokenAccount(conn, admin, mint, payee.publicKey);
    const address = pda.service(s.id);
    if (!(await conn.getAccountInfo(address))) {
      await program.methods
        .registerService(s.id, s.label, new BN(usdc(s.price).toString()))
        .accounts({ admin: admin.publicKey, payeeToken: payeeToken.address })
        .rpc();
    }
    services[s.id] = {
      address: address.toBase58(),
      payee: payee.publicKey.toBase58(),
      payeeToken: payeeToken.address.toBase58(),
      price: s.price,
    };
  }
  console.log(`services ${Object.keys(services).join(', ')}`);

  const team = pda.team(owner.publicKey);
  const vault = pda.vault(mint, team);
  const asSponsor = client(conn, sponsor);
  if (!(await conn.getAccountInfo(team))) {
    await asSponsor.methods
      .createTeam('Acme Research')
      .accounts({ payer: sponsor.publicKey, owner: owner.publicKey, mint })
      .signers([owner])
      .rpc();
  }
  const balance = (await getAccount(conn, vault)).amount;
  if (balance < 200n * U) await mintTo(conn, admin, mint, vault, mintAuthority, 500n * U - balance);
  console.log(`team    ${team.toBase58()}  vault ${vault.toBase58()}  ${fmt((await getAccount(conn, vault)).amount)} USDC`);

  // The research agent: 5 USDC per payment, 20 USDC a day, 10 payments a day, 30 days.
  // It may pay search, inference, market data and GPU time. Not the premium dataset.
  const now = Math.floor(Date.now() / 1000);
  const grants = [
    {
      who: agent,
      kind: { agent: {} },
      label: 'Research agent',
      policy: { allowance: 20n * U, periodSecs: DAY, cap: 5n * U, maxPayments: 10, expiresAt: now + 30 * DAY },
      services: ['web-search', 'llm-inference', 'market-data', 'gpu-hour'],
    },
    {
      who: person,
      kind: { person: {} },
      label: 'Ada, operations',
      policy: { allowance: 100n * U, periodSecs: 7 * DAY, cap: 25n * U, maxPayments: 20, expiresAt: now + 30 * DAY },
      services: SERVICES.map((s) => s.id),
    },
  ];
  for (const g of grants) {
    const spender = pda.spender(team, g.who.publicKey);
    if (await conn.getAccountInfo(spender)) continue;
    await asSponsor.methods
      .addSpender(
        g.who.publicKey,
        g.kind as never,
        g.label,
        {
          allowance: new BN(g.policy.allowance.toString()),
          periodSecs: g.policy.periodSecs,
          cap: new BN(g.policy.cap.toString()),
          maxPayments: g.policy.maxPayments,
          expiresAt: new BN(g.policy.expiresAt),
        },
        g.services.map((id) => pda.service(id)),
      )
      .accounts({ payer: sponsor.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();
  }

  const out = {
    cluster: cluster(),
    rpc: rpcUrl(),
    programId: program.programId.toBase58(),
    config: config.toBase58(),
    mint: mint.toBase58(),
    mintAuthority: mintAuthority.publicKey.toBase58(),
    sponsor: sponsor.publicKey.toBase58(),
    team: team.toBase58(),
    teamName: 'Acme Research',
    vault: vault.toBase58(),
    owner: owner.publicKey.toBase58(),
    agent: { authority: agent.publicKey.toBase58(), spender: pda.spender(team, agent.publicKey).toBase58() },
    person: { authority: person.publicKey.toBase58(), spender: pda.spender(team, person.publicKey).toBase58() },
    services,
    seededAt: new Date().toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
