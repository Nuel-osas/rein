// Sets up the compute gateway on devnet. Re-runnable: anything that exists is checked, not redone.
//   REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm exec tsx scripts/compute-setup.ts
//
// 1. The gateway key, ~/.config/rein/gateway.json (mode 600, never in the repo). It owns the
//    test-USDC account every compute service pays, and signs refunds (the sponsor pays their fee).
// 2. That key's test-USDC associated token account, created with the CLI wallet paying rent.
// 3. One registry service per real offering (web/lib/server/compute/catalog.ts), registered by the
//    admin (the CLI wallet ~/.config/solana/id.json) with the gateway account as payee.
// 4. The placeholder services from the first demo (scripts/seed.ts before 2026-11-09) suspended with
//    set_service_active(false): nothing delivered them, so nothing may pay them.
// 5. The addresses and signatures to deploy/devnet.json ("compute") and a section of docs/CONSTANTS.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BN } from '@coral-xyz/anchor';
import { getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { Connection } from '@solana/web3.js';
import { adminKey, client, cluster, deployFile, explorer, key, pda, rpcUrl, usdc } from './lib';

// Keep in step with SERVICE_TABLE in web/lib/server/compute/catalog.ts (labels are fixed once registered).
const COMPUTE = [
  { id: 'ai-chat', label: '0G Chat (0GM-1.0-35B-A3B)', model: '0GM-1.0-35B-A3B (wallet route, TEE)', price: '0.01' },
  { id: 'ai-image', label: '0G Image, Z-Image-Turbo (TEE)', model: 'z-image-turbo (wallet route, TEE)', price: '0.02' },
  { id: 'ai-voice', label: '0G Voice, Whisper v3 (TEE)', model: 'openai/whisper-large-v3 (wallet route, TEE)', price: '0.02' },
  { id: 'ai-claude', label: 'Claude via 0G (relayed, no TEE)', model: 'claude-haiku-5.5 by default (0G Router only, relayed, no TEE)', price: '0.01' },
  { id: 'ai-gpt', label: 'GPT via 0G (relayed, no TEE)', model: 'gpt-5.6-luna by default (0G Router only, relayed, no TEE)', price: '0.01' },
];

// The first demo's stand-in services: registered with throwaway payees and never delivered by anyone.
const PLACEHOLDERS = ['web-search', 'llm-inference', 'market-data', 'gpu-hour', 'premium-dataset'];

async function main() {
  if (cluster() !== 'devnet') throw new Error('run with REIN_CLUSTER=devnet');
  const conn = new Connection(rpcUrl(), 'confirmed');
  const admin = adminKey();
  const program = client(conn, admin);
  const cfg = await program.account.config.fetch(pda.config());
  if (!cfg.admin.equals(admin.publicKey)) throw new Error(`the registry admin is ${cfg.admin.toBase58()}, not this CLI wallet`);
  const mint = cfg.mint;

  const gateway = key('gateway');
  const expected = getAssociatedTokenAddressSync(mint, gateway.publicKey);
  const existed = !!(await conn.getAccountInfo(expected));
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, mint, gateway.publicKey);
  const acct = await getAccount(conn, ata.address, 'confirmed');
  if (!acct.owner.equals(gateway.publicKey) || !acct.mint.equals(mint)) throw new Error('gateway token account has the wrong owner or mint');
  console.log(`gateway        ${gateway.publicKey.toBase58()}`);
  console.log(`gateway token  ${ata.address.toBase58()} ${existed ? '(existed)' : '(created)'} balance ${acct.amount}`);

  const services: Record<string, { address: string; payeeToken: string; label: string; model: string; price: string; registerTx: string | null }> = {};
  for (const s of COMPUTE) {
    const address = pda.service(s.id);
    let registerTx: string | null = null;
    if (!(await conn.getAccountInfo(address))) {
      registerTx = await program.methods
        .registerService(s.id, s.label, new BN(usdc(s.price).toString()))
        .accountsPartial({ admin: admin.publicKey, payeeToken: ata.address })
        .rpc();
      console.log(`registered     ${s.id}  ${explorer('tx', registerTx)}`);
    }
    const svc = await program.account.service.fetch(address);
    if (!svc.payeeToken.equals(ata.address)) throw new Error(`${s.id} is registered with payee ${svc.payeeToken.toBase58()}, not the gateway account`);
    if (!svc.active) throw new Error(`${s.id} is suspended`);
    services[s.id] = { address: address.toBase58(), payeeToken: ata.address.toBase58(), label: s.label, model: s.model, price: s.price, registerTx };
    console.log(`service        ${s.id}  ${address.toBase58()}  payee ok, active`);
  }

  const suspended: Record<string, { address: string; suspendTx: string | null }> = {};
  for (const id of PLACEHOLDERS) {
    const address = pda.service(id);
    if (!(await conn.getAccountInfo(address))) continue;
    let suspendTx: string | null = null;
    if ((await program.account.service.fetch(address)).active) {
      suspendTx = await program.methods.setServiceActive(false).accountsPartial({ admin: admin.publicKey, service: address }).rpc();
      console.log(`suspended      ${id}  ${explorer('tx', suspendTx)}`);
    }
    if ((await program.account.service.fetch(address)).active) throw new Error(`${id} is still active`);
    suspended[id] = { address: address.toBase58(), suspendTx };
    console.log(`placeholder    ${id}  ${address.toBase58()}  suspended`);
  }

  const file = deployFile();
  const deploy = JSON.parse(readFileSync(file, 'utf8'));
  const prior = deploy.compute?.services ?? {};
  for (const [id, v] of Object.entries(services)) if (!v.registerTx && prior[id]?.registerTx) v.registerTx = prior[id].registerTx;
  const priorSuspended = deploy.compute?.suspended ?? {};
  for (const [id, v] of Object.entries(suspended)) if (!v.suspendTx && priorSuspended[id]?.suspendTx) v.suspendTx = priorSuspended[id].suspendTx;
  deploy.compute = { ...deploy.compute, gateway: gateway.publicKey.toBase58(), gatewayToken: ata.address.toBase58(), services, suspended, setupAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(deploy, null, 2) + '\n');

  const rows = Object.entries(services)
    .map(([id, v]) => `| \`${id}\` service (\`["service", "${id}"]\`) | \`${v.address}\` | ${v.registerTx ? `\`register_service\` tx [\`${v.registerTx.slice(0, 8)}…\`](${explorer('tx', v.registerTx)}); ` : ''}\`scripts/compute-setup.ts\` fetched the account: payee token = the gateway token account, active, label "${v.label}", list price ${v.price}. Backed by ${v.model} |`)
    .join('\n');
  const suspendedRows = Object.entries(suspended)
    .map(([id, v]) => `| \`${id}\` (placeholder, suspended) | \`${v.address}\` | ${v.suspendTx ? `\`set_service_active(false)\` tx [\`${v.suspendTx.slice(0, 8)}…\`](${explorer('tx', v.suspendTx)}); ` : ''}\`scripts/compute-setup.ts\` fetched the account: active = false, so \`pay\` is refused (\`ServiceSuspended\`) and a pending payment to it is refused at approval |`)
    .join('\n');
  const section = [
    '<!-- compute:start -->',
    '## Compute gateway (devnet, written by `scripts/compute-setup.ts`)',
    '',
    '| What | Value | Verified by |',
    '|---|---|---|',
    `| Gateway key | \`${gateway.publicKey.toBase58()}\` | Generated by the script into \`~/.config/rein/gateway.json\` (mode 600; production reads \`REIN_GATEWAY_SECRET\`). Never in the repo |`,
    `| Gateway test-USDC account | \`${ata.address.toBase58()}\` | ATA of the gateway key for the config mint; \`getAccount\` checked owner = gateway key, mint = \`${mint.toBase58()}\`. Every compute service pays it; refunds leave from it |`,
    rows,
    suspendedRows,
    '',
    'Prices are not fixed: each quote asks 0G for the worst case of one run (live provider prices × 0G\'s USD rate) × 1.5, at least 0.01 test USDC. The list price above is only what the registry shows.',
    '<!-- compute:end -->',
  ].join('\n');
  const docs = join(__dirname, '..', 'docs', 'CONSTANTS.md');
  let text = readFileSync(docs, 'utf8');
  const re = /<!-- compute:start -->[\s\S]*?<!-- compute:end -->/;
  text = re.test(text) ? text.replace(re, section) : `${text.trimEnd()}\n\n${section}\n`;
  writeFileSync(docs, text);
  console.log(`wrote          ${file} and docs/CONSTANTS.md`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
