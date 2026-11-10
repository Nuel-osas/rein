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

export type ServiceKind = 'chat' | 'image' | 'voice' | 'claude' | 'gpt' | 'video';
export type InputKind = 'prompt' | 'audio';
export type OutputKind = 'text' | 'image' | 'video';

/**
 * One compute service from the gateway's catalog. The catalog lists every service the gateway knows
 * (also unregistered, suspended or unconfigured ones), so read `buyable` before offering one and
 * `grantable()` before granting one to an agent. `unavailable` is the gateway's reason when it cannot
 * sell the service right now (kept for older callers).
 */
export type CatalogService = {
  id: string;
  /** Registry label (at most 32 bytes). */
  label: string;
  /** Display name, e.g. "0G Chat, run by Rein on 0G". Falls back to the label. */
  name: string;
  model: string | null;
  summary: string | null;
  kind: ServiceKind | null;
  input: InputKind;
  output: OutputKind;
  trust: 'tee' | 'relayed' | null;
  /** "TEE verified" or "Relayed, no TEE", as the gateway says it; null when it did not say. */
  trustLabel: string | null;
  /** False: the gateway has no key for its backend yet (the 0G Private Computer key for Router services). */
  configured: boolean;
  registered: boolean;
  active: boolean;
  maxPromptChars: number | null;
  maxTokens: number | null;
  maxAudioBytes: number | null;
  maxAudioSeconds: number | null;
  audioTypes: string[] | null;
  available: boolean;
  /** Display price ("$0.02"), or null when it cannot be quoted right now. */
  price: string | null;
  /** The same price in base units; null when unknown. */
  priceUnits: bigint | null;
  reason: string | null;
  unavailable: string | null;
  /** Registered, active, configured and quotable now: the UI may offer it. */
  buyable: boolean;
};

/** A service the gateway names but does not sell yet, with why. Never registered, never bought. */
export type ComingSoon = { id: string; name: string; kind: ServiceKind | null; output: OutputKind; model: string | null; trust: 'tee' | 'relayed' | null; trustLabel: string | null; reason: string };

export type Catalog = { ok: true; services: CatalogService[]; comingSoon: ComingSoon[] } | { ok: false; missing: boolean; error: string };

const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KINDS: readonly ServiceKind[] = ['chat', 'image', 'voice', 'claude', 'gpt', 'video'];

/** The catalog's display price (price_usdc, "0.01") as "$0.01"; anything else as given, or null. */
function priceText(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? `$${s}` : s.slice(0, 40);
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const kindOf = (v: unknown): ServiceKind | null => (typeof v === 'string' && (KINDS as readonly string[]).includes(v) ? (v as ServiceKind) : null);
const trustOf = (v: unknown): 'tee' | 'relayed' | null => (v === 'tee' || v === 'relayed' ? v : null);
const outputOf = (v: unknown): OutputKind => (v === 'image' || v === 'video' ? v : 'text');

/** The services an agent may be granted: registered and active in the registry, at most MAX_SERVICES. */
export function grantable(catalog: Catalog | undefined | null): CatalogService[] {
  return catalog?.ok ? catalog.services.filter((s) => s.registered && s.active).slice(0, MAX_SERVICES) : [];
}

function parseService(x: Record<string, unknown>): CatalogService | null {
  const id = typeof x?.id === 'string' ? x.id : typeof x?.service === 'string' ? x.service : null;
  if (!id || !SERVICE_ID_RE.test(id)) return null;
  const label = str(x.label, 64) ?? id;
  // An older catalog had none of these fields and listed only what it sold: absent means yes.
  const available = x.available !== false;
  const registered = x.registered !== false;
  const active = x.active !== false;
  const configured = x.configured !== false;
  const reason = str(x.reason, 240);
  const audioTypes = Array.isArray(x.audio_types) ? x.audio_types.filter((t): t is string => typeof t === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(t)).slice(0, 12) : [];
  return {
    id,
    label,
    name: str(x.name, 80) ?? label,
    model: str(x.model, 80),
    summary: str(x.summary, 240),
    kind: kindOf(x.kind),
    input: x.input === 'audio' ? 'audio' : 'prompt',
    output: outputOf(x.output),
    trust: trustOf(x.trust),
    trustLabel: str(x.trust_label, 40),
    configured,
    registered,
    active,
    maxPromptChars: posInt(x.max_prompt_chars),
    maxTokens: posInt(x.max_tokens),
    maxAudioBytes: posInt(x.max_audio_bytes),
    maxAudioSeconds: posInt(x.max_audio_seconds),
    audioTypes: audioTypes.length ? audioTypes : null,
    available,
    price: priceText(x.price_usdc ?? x.amount_usdc),
    priceUnits: typeof x.price === 'string' && /^\d{1,19}$/.test(x.price) ? BigInt(x.price) : null,
    reason,
    unavailable: available ? null : (reason ?? 'not available right now').slice(0, 120),
    buyable: available && registered && active && configured,
  };
}

function parseComingSoon(x: Record<string, unknown>): ComingSoon | null {
  const id = typeof x?.id === 'string' && SERVICE_ID_RE.test(x.id) ? x.id : null;
  if (!id) return null;
  return { id, name: str(x.name, 80) ?? id, kind: kindOf(x.kind), output: outputOf(x.output), model: str(x.model, 80), trust: trustOf(x.trust), trustLabel: str(x.trust_label, 40), reason: str(x.reason, 400) ?? 'Not sold yet.' };
}

/**
 * Every compute service the gateway knows, from GET /api/compute/catalog, with whether each can be
 * bought now, plus the ones it names as coming soon. `missing` is true when the route does not
 * exist here (the gateway is not merged or not live): compute not configured.
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
  const services = list.flatMap((x) => parseService(x) ?? []);
  const soon = (Array.isArray(j.coming_soon) ? (j.coming_soon as Record<string, unknown>[]) : []).flatMap((x) => parseComingSoon(x) ?? []);
  if (!services.length) return { ok: false, missing: false, error: 'The compute catalog lists no services yet.' };
  return { ok: true, services: services.slice(0, 16), comingSoon: soon.slice(0, 8) };
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

/**
 * Why a run cannot be bought from this vault, or null when it can (or when either amount is unknown:
 * the program still refuses a payment the vault cannot cover, so an unknown read blocks nothing).
 * Stops a quote and a payment that could only fail, or wait for an approval that cannot settle.
 */
export function vaultShortfall(price: bigint | null, balance: bigint | null, kind: ServiceKind | null, fmt: (units: bigint) => string): string | null {
  if (price === null || balance === null || price <= balance) return null;
  if (balance === 0n) return 'The team vault is empty. Claim your test USDC first.';
  const why = `This run costs ${fmt(price)} and the team vault holds ${fmt(balance)}, so it cannot be paid.`;
  return kind === 'video' ? `${why} A clip costs more than one claim of test USDC; watch one being made on the live demo.` : why;
}
