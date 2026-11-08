// The Rein agent as a team sees it: the key the gateway lane runs for this team (GET /api/agent/key),
// the compute services it may buy, and the starter policy it gets on first sign-in. Shared by the
// sign-in setup, the budget card and the compute run panel. Browser-safe: no keys here.

import { PublicKey, type Connection } from '@solana/web3.js';
import { parseAddress } from './chain';
import { pda, toService, type Policy, type Service, type Spender } from './rein';

export const AGENT_LABEL = 'Rein agent';
export const COMPUTE_SERVICE_IDS = ['claude-run', 'codex-run'] as const;
export type ComputeServiceId = (typeof COMPUTE_SERVICE_IDS)[number];
/** The gateway's compute intents: "c" and 31 more characters (web/lib/server/compute/core.ts, INTENT_RE). */
export const COMPUTE_INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;

const DAY = 86_400;

/** 0.05 test USDC a day, 0.02 a run, 5 runs a day, for 30 days. Base units. */
export function starterPolicy(nowSecs: number): Policy {
  return { allowance: 50_000n, periodSecs: DAY, cap: 20_000n, maxPayments: 5, expiresAt: nowSecs + 30 * DAY };
}

/** The team's name from the Google name ("Ada's team"), or "My team"; always within 32 bytes. */
export function teamNameFor(googleName: string | null | undefined): string {
  const n = (googleName ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.includes('@')) return 'My team';
  const first = n.split(' ')[0];
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  for (const candidate of [`${n}'s team`, `${first}'s team`, first]) if (bytes(candidate) <= 32) return candidate;
  return 'My team';
}

export type AgentKey = { ok: true; key: PublicKey } | { ok: false; missing: boolean; error: string };

/**
 * The Rein agent's public key for a team, from the gateway lane's GET /api/agent/key?team=. `missing`
 * is true when the route does not exist on this deployment (the gateway is not merged or not live).
 */
export async function fetchAgentKey(team: string): Promise<AgentKey> {
  let res: Response;
  try {
    res = await fetch(`/api/agent/key?team=${encodeURIComponent(team)}`, { cache: 'no-store' });
  } catch {
    return { ok: false, missing: false, error: 'Could not reach the server to get your agent’s key. Try again.' };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 404 && !json) return { ok: false, missing: true, error: 'The Rein agent is not available on this deployment yet (no /api/agent/key).' };
  if (!res.ok || !json) return { ok: false, missing: res.status === 404, error: typeof json?.error === 'string' ? json.error : `The agent key route answered ${res.status}.` };
  const raw = [json.key, json.address, json.publicKey, json.authority, json.agent].find((v) => typeof v === 'string') as string | undefined;
  const addr = parseAddress(raw ?? null);
  if (!addr) return { ok: false, missing: false, error: 'The agent key route returned no valid public key.' };
  return { ok: true, key: new PublicKey(addr) };
}

export type ComputeServices = {
  /** Every compute service id with its registry PDA; `service` is null when not registered yet. */
  rows: { id: ComputeServiceId; address: string; service: Service | null }[];
} | null;

/** Resolves claude-run and codex-run by id from the registry. null when the read failed (unknown). */
export async function readComputeServices(conn: Connection): Promise<ComputeServices> {
  const addresses = COMPUTE_SERVICE_IDS.map((id) => pda.service(id));
  try {
    const infos = await conn.getMultipleAccountsInfo(addresses, 'confirmed');
    return {
      rows: COMPUTE_SERVICE_IDS.map((id, i) => ({ id, address: addresses[i].toBase58(), service: toService(addresses[i].toBase58(), infos[i]) })),
    };
  } catch {
    return null;
  }
}

/** The team's Rein agent: the spender whose authority is the agent key, else the one labelled "Rein agent". */
export function findReinAgent(spenders: Spender[] | null, agentKey: string | null): Spender | null {
  if (!spenders) return null;
  const live = spenders.filter((s) => s.status !== 'revoked');
  return (agentKey && live.find((s) => s.authority === agentKey)) || live.find((s) => s.kind === 'agent' && s.label === AGENT_LABEL) || null;
}
