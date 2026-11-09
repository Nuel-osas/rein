// Points the demo team's research agent at the real services and a budget sized to real 0G prices.
//   REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm exec tsx scripts/demo-agent.ts
//
// Signed by the demo team's owner (~/.config/rein/demo-owner.json); the sponsor pays the fees.
// 1. set_services: ai-chat, ai-image, ai-voice. ai-claude and ai-gpt are left off on purpose, so the
//    agent buying them files a real Pending payment (service_not_allowed) for the owner to approve.
// 2. set_policy: 0.05 per payment, 0.50 per hour, 20 payments per hour, 30 days from now.
// Re-runnable: a step whose state already matches is skipped. Writes deploy/devnet.json ("demoAgent").

import { readFileSync, writeFileSync } from 'node:fs';
import { BN } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { client, cluster, deployFile, explorer, fmt, key, pda, rpcUrl } from './lib';

const ALLOWED = ['ai-chat', 'ai-image', 'ai-voice'];
const POLICY = { allowance: 500_000n, periodSecs: 3600, cap: 50_000n, maxPayments: 20 };
const DAY = 86_400;

async function main() {
  if (cluster() !== 'devnet') throw new Error('run with REIN_CLUSTER=devnet');
  const file = deployFile();
  const deploy = JSON.parse(readFileSync(file, 'utf8'));
  const conn = new Connection(rpcUrl(), 'confirmed');
  const owner = key('demo-owner');
  const sponsor = key('sponsor');
  const team = new PublicKey(deploy.team);
  const spender = new PublicKey(deploy.agent.spender);
  if (!owner.publicKey.equals(new PublicKey(deploy.owner))) throw new Error('demo-owner.json is not the recorded demo team owner');
  const program = client(conn, sponsor);
  const t = await program.account.team.fetch(team);
  if (!t.owner.equals(owner.publicKey)) throw new Error(`the demo team's owner is ${t.owner.toBase58()}, not demo-owner.json`);
  const before = await program.account.spender.fetch(spender);
  if (!before.team.equals(team)) throw new Error('that spender is not on the demo team');

  // Every allowed service must be registered and active before the agent is pointed at it.
  const wanted = ALLOWED.map((id) => pda.service(id));
  for (const [i, address] of wanted.entries()) {
    const s = await program.account.service.fetch(address);
    if (!s.active) throw new Error(`${ALLOWED[i]} is suspended`);
  }

  let servicesTx: string | null = null;
  const same = before.services.length === wanted.length && before.services.every((k: PublicKey, i: number) => k.equals(wanted[i]));
  if (!same) {
    servicesTx = await program.methods.setServices(wanted).accountsPartial({ owner: owner.publicKey, team, spender }).signers([owner]).rpc();
    console.log(`set_services   ${ALLOWED.join(', ')}  ${explorer('tx', servicesTx)}`);
  }

  let policyTx: string | null = null;
  const p = before.policy;
  const policyOk =
    BigInt(p.allowance.toString()) === POLICY.allowance && p.periodSecs === POLICY.periodSecs && BigInt(p.cap.toString()) === POLICY.cap && p.maxPayments === POLICY.maxPayments && p.expiresAt.toNumber() > Date.now() / 1000 + 7 * DAY;
  if (!policyOk) {
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * DAY;
    policyTx = await program.methods
      .setPolicy({ allowance: new BN(POLICY.allowance.toString()), periodSecs: POLICY.periodSecs, cap: new BN(POLICY.cap.toString()), maxPayments: POLICY.maxPayments, expiresAt: new BN(expiresAt) })
      .accountsPartial({ owner: owner.publicKey, team, spender })
      .signers([owner])
      .rpc();
    console.log(`set_policy     cap ${fmt(POLICY.cap)}, ${fmt(POLICY.allowance)} per hour, ${POLICY.maxPayments} payments  ${explorer('tx', policyTx)}`);
  }

  const after = await program.account.spender.fetch(spender);
  const ids = after.services.map((k: PublicKey) => ALLOWED[wanted.findIndex((w) => w.equals(k))] ?? k.toBase58());
  console.log(`spender        ${spender.toBase58()}  services [${ids.join(', ')}]  cap ${fmt(BigInt(after.policy.cap.toString()))}  allowance ${fmt(BigInt(after.policy.allowance.toString()))}/${after.policy.periodSecs}s  max ${after.policy.maxPayments}  expires ${new Date(after.policy.expiresAt.toNumber() * 1000).toISOString()}`);

  const prior = deploy.demoAgent ?? {};
  deploy.demoAgent = {
    spender: spender.toBase58(),
    services: ids,
    policy: { cap: fmt(BigInt(after.policy.cap.toString())), allowance: fmt(BigInt(after.policy.allowance.toString())), periodSecs: after.policy.periodSecs, maxPayments: after.policy.maxPayments, expiresAt: new Date(after.policy.expiresAt.toNumber() * 1000).toISOString() },
    setServicesTx: servicesTx ?? prior.setServicesTx ?? null,
    setPolicyTx: policyTx ?? prior.setPolicyTx ?? null,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(deploy, null, 2) + '\n');
  console.log(`wrote          ${file}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
