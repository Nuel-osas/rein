/**
 * pnpm agent <research|overspend|injection|"free text task">
 *
 * Env: GROQ_API_KEY, REIN_RPC_URL, REIN_TEAM, optional REIN_PROGRAM_ID, REIN_AGENT_MODEL,
 * REIN_AGENT_SECRET and REIN_SPONSOR_SECRET (JSON byte arrays; otherwise ~/.config/rein/
 * demo-agent.json and sponsor.json).
 */
import { PublicKey } from '@solana/web3.js';
import { runAgent } from './agent.ts';
import { formatUsdc } from './amount.ts';
import type { AgentEvent } from './events.ts';
import { DEFAULT_MODEL } from './groq.ts';
import { loadKeypair } from './keys.ts';
import { isScenarioId, SCENARIOS } from './scenarios.ts';

const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2), bold = c(1), green = c(32), yellow = c(33), red = c(31), cyan = c(36), magenta = c(35);

function explorer(sig: string, rpc: string): string {
  const cluster = /devnet/.test(rpc) ? 'devnet' : /mainnet/.test(rpc) ? '' : `custom&customUrl=${encodeURIComponent(rpc)}`;
  return `https://explorer.solana.com/tx/${sig}${cluster ? `?cluster=${cluster}` : ''}`;
}

function print(e: AgentEvent, rpc: string): void {
  const tag = 'probe' in e && e.probe ? magenta('[red-team] ') : '';
  switch (e.type) {
    case 'thinking':
      console.log(`${tag}${dim('· ' + e.text.replace(/\n/g, '\n  '))}`);
      break;
    case 'tool_call':
      console.log(`${tag}${cyan('→ ' + e.name)}(${JSON.stringify(e.args)})`);
      break;
    case 'tool_result':
      console.log(`${tag}${dim('← ' + e.name + ' ' + JSON.stringify(e.result))}`);
      break;
    case 'payment': {
      const color = e.status === 'paid' ? green : e.status === 'pending' ? yellow : red;
      const amt = e.amount === null ? '?' : formatUsdc(e.amount);
      console.log(`${tag}${color(bold(`$ ${e.status.toUpperCase()}`))} ${e.service} ${amt} USDC` +
        (e.reasons?.length ? ` reasons=${e.reasons.join(',')}` : '') +
        (e.unconfirmed ? ' (unconfirmed: do not retry)' : '') +
        (e.error ? `\n    ${e.error}` : ''));
      if (e.signature) console.log(`    sig ${e.signature}\n    ${dim(explorer(e.signature, rpc))}`);
      if (e.payment && (e.status === 'paid' || e.status === 'pending')) console.log(dim(`    record ${e.payment} (intent ${e.intent})`));
      break;
    }
    case 'final':
      console.log(`\n${bold('Summary')}\n${e.text}${e.error ? red(`\n(error: ${e.error})`) : ''}`);
      break;
  }
}

async function main(): Promise<number> {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.error(`usage: pnpm agent <${Object.keys(SCENARIOS).join('|')}|"free text task">`);
    return 2;
  }
  const rpc = process.env.REIN_RPC_URL;
  const teamStr = process.env.REIN_TEAM;
  if (!rpc) { console.error('REIN_RPC_URL is not set'); return 2; }
  if (!teamStr) { console.error('REIN_TEAM is not set'); return 2; }
  let team: PublicKey;
  try { team = new PublicKey(teamStr); } catch { console.error('REIN_TEAM is not a valid address'); return 2; }
  const agent = loadKeypair('REIN_AGENT_SECRET', 'demo-agent.json');
  const sponsor = loadKeypair('REIN_SPONSOR_SECRET', 'sponsor.json');

  const scenario = isScenarioId(arg) ? SCENARIOS[arg] : null;
  const task = scenario ? scenario.task : arg;
  const model = process.env.REIN_AGENT_MODEL ?? DEFAULT_MODEL;
  console.log(bold(scenario ? `Scenario: ${scenario.title}` : 'Task'));
  console.log(dim(task));
  console.log(dim(`model ${model} · agent ${agent.publicKey.toBase58()} · team ${team.toBase58()} · ${rpc}\n`));

  let failed = false;
  for await (const e of runAgent({ task, rpcUrl: rpc, programId: process.env.REIN_PROGRAM_ID, team, agent, sponsor, model, probe: scenario?.probe })) {
    print(e, rpc);
    if (e.type === 'final' && e.error) failed = true;
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(red(`error: ${(e as Error).message}`));
  process.exit(1);
});
