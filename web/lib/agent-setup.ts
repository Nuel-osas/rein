// The Rein agent as a team sees it: the key the gateway lane runs for this team (GET /api/agent/key),
// the compute services it may buy (the gateway's GET /api/compute/catalog, runs on the 0G Compute
// Network), and the starter policy it gets on first sign-in. Shared by the sign-in setup, the budget
// card and the compute run panel. Browser-safe: no keys here.

import { PublicKey, type Connection } from '@solana/web3.js';
import { parseAddress } from './chain';
import { MAX_SERVICES, pda, toService, type Policy, type Service, type Spender } from './rein';

export const AGENT_LABEL = 'Rein agent';
/** The gateway's compute intents: "c" and 31 more characters (web/lib/server/compute/core.ts, INTENT_RE). */
export const COMPUTE_INTENT_RE = /^c[A-Za-z0-9_-]{31}$/;

const DAY = 86_400;

/** 0.30 test USDC per 30 days (the claim), 0.05 a run, 20 runs a period, for 30 days. Base units. */
export function starterPolicy(nowSecs: number): Policy {
  return { allowance: 300_000n, periodSecs: 30 * DAY, cap: 50_000n, maxPayments: 20, expiresAt: nowSecs + 30 * DAY };
}

/** `unavailable` is the gateway's reason when it cannot sell the service right now (still granted: it is registered). */
export type CatalogService = { id: string; label: string; model: string | null; price: string | null; unavailable: string | null };
export type Catalog = { ok: true; services: CatalogService[] } | { ok: false; missing: boolean; error: string };

const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The catalog's display price (price_usdc, "0.01") as "$0.01"; anything else as given, or null. */
function priceText(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? `$${s}` : s.slice(0, 40);
}

/**
 * The compute services the gateway sells right now, from GET /api/compute/catalog. `missing` is true
 * when the route does not exist here (the gateway is not merged or not live): compute not configured.
 */
export async function fetchCatalog(): Promise<Catalog> {
  let res: Response;
  try {
    res = await fetch('/api/compute/catalog', { cache: 'no-store' });
  } catch {
    return { ok: false, missing: false, error: 'Could not reach the compute catalog. Try again.' };
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || json === null) {
    const err = (json as { error?: unknown } | null)?.error;
    return { ok: false, missing: res.status === 404 && json === null, error: typeof err === 'string' ? err : 'Compute is not configured on this deployment yet.' };
  }
  const j = json as Record<string, unknown>;
  const list = (Array.isArray(json) ? json : [j.services, j.catalog, j.items].find(Array.isArray) ?? []) as Record<string, unknown>[];
  const services = list.flatMap((x): CatalogService[] => {
    const id = typeof x?.id === 'string' ? x.id : typeof x?.service === 'string' ? x.service : null;
    if (!id || !SERVICE_ID_RE.test(id) || x.active === false) return [];
    return [{
      id,
      label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : id,
      model: typeof x.model === 'string' ? x.model : null,
      price: priceText(x.price_usdc ?? x.amount_usdc),
      unavailable: x.available === false ? (typeof x.reason === 'string' ? x.reason.slice(0, 120) : 'not available right now') : null,
    }];
  });
  if (!services.length) return { ok: false, missing: false, error: 'The compute catalog lists no active services yet.' };
  return { ok: true, services: services.slice(0, MAX_SERVICES) };
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
  rows: { id: string; address: string; service: Service | null }[];
} | null;

/** Resolves service ids to their registry PDAs and accounts. null when the read failed (unknown). */
export async function readComputeServices(conn: Connection, ids: string[]): Promise<ComputeServices> {
  const addresses = ids.map((id) => pda.service(id));
  try {
    const infos = await conn.getMultipleAccountsInfo(addresses, 'confirmed');
    return { rows: ids.map((id, i) => ({ id, address: addresses[i].toBase58(), service: toService(addresses[i].toBase58(), infos[i]) })) };
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
