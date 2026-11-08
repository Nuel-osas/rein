// The Rein program, as the app sees it: PDAs, account decoding into plain types with bigint money,
// reads of one team, and instruction builders. Shared by the browser and the API routes.
// Account layouts and instruction encodings come from the IDL (lib/idl/rein.json, a copy of
// ../idl/rein.json; `pnpm idl:check` compares them).

import { BN, BorshCoder, type Idl } from '@coral-xyz/anchor';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from '@solana/web3.js';
import idlJson from './idl/rein.json';
import { PROGRAM_ID } from './chain';

const idl = idlJson as unknown as Idl;
export const coder = new BorshCoder(idl);

// ---------------------------------------------------------------------------------- limits ---
// Mirrors programs/rein/src/lib.rs, so the forms refuse what the program would refuse.

export const MAX_SERVICES = 8;
export const LABEL_MAX = 32;
export const MEMO_MAX = 64;
export const INTENT_MAX = 32;
export const MIN_PERIOD_SECS = 60;
export const PENDING_TTL_SECS = 24 * 60 * 60;

export const OVER_SERVICE = 1;
export const OVER_CAP = 2;
export const OVER_ALLOWANCE = 4;
export const OVER_COUNT = 8;

export const REASON_TEXT: Record<number, string> = {
  [OVER_SERVICE]: 'service not on its list',
  [OVER_CAP]: 'over the per-payment cap',
  [OVER_ALLOWANCE]: 'over the allowance',
  [OVER_COUNT]: 'over the payment count',
};

export function reasonsOf(bits: number): string[] {
  return [OVER_SERVICE, OVER_CAP, OVER_ALLOWANCE, OVER_COUNT].filter((b) => (bits & b) !== 0).map((b) => REASON_TEXT[b]);
}

// ----------------------------------------------------------------------------------- types ---

export type Kind = 'person' | 'agent';
export type SpenderStatus = 'active' | 'paused' | 'revoked';
export type PaymentStatus = 'paid' | 'pending' | 'settled' | 'declined' | 'cancelled' | 'refused';

export type Policy = { allowance: bigint; periodSecs: number; cap: bigint; maxPayments: number; expiresAt: number };

export type Config = { address: string; admin: string; mint: string; services: number };

export type Service = { address: string; id: string; label: string; payee: string; payeeToken: string; price: bigint; active: boolean };

export type Team = {
  address: string;
  owner: string;
  mint: string;
  vault: string;
  name: string;
  paused: boolean;
  spenders: number;
  payments: bigint;
  paidCount: bigint;
  paidTotal: bigint;
  createdAt: number;
};

export type Spender = {
  address: string;
  team: string;
  authority: string;
  kind: Kind;
  label: string;
  status: SpenderStatus;
  generation: number;
  policy: Policy;
  services: string[];
  periodStart: number;
  spent: bigint;
  count: number;
  addedAt: number;
};

export type Payment = {
  address: string;
  team: string;
  spender: string;
  authority: string;
  kind: Kind;
  service: string;
  payeeToken: string;
  amount: bigint;
  intent: string;
  memo: string;
  generation: number;
  reasons: number;
  status: PaymentStatus;
  createdAt: number;
  deadline: number;
  decidedAt: number;
  number: bigint;
};

// ------------------------------------------------------------------------------------ PDAs ---

const enc = new TextEncoder();
const seed = (s: string) => enc.encode(s);

export const pda = {
  config: () => PublicKey.findProgramAddressSync([seed('config')], PROGRAM_ID)[0],
  service: (id: string) => PublicKey.findProgramAddressSync([seed('service'), seed(id)], PROGRAM_ID)[0],
  team: (owner: PublicKey) => PublicKey.findProgramAddressSync([seed('team'), owner.toBytes()], PROGRAM_ID)[0],
  spender: (team: PublicKey, authority: PublicKey) =>
    PublicKey.findProgramAddressSync([seed('spender'), team.toBytes(), authority.toBytes()], PROGRAM_ID)[0],
  payment: (spender: PublicKey, intent: string) =>
    PublicKey.findProgramAddressSync([seed('payment'), spender.toBytes(), seed(intent)], PROGRAM_ID)[0],
  vault: (mint: PublicKey, team: PublicKey) => getAssociatedTokenAddressSync(mint, team, true),
};

// -------------------------------------------------------------------------------- decoding ---

/* eslint-disable @typescript-eslint/no-explicit-any */
const big = (v: any): bigint => BigInt(v.toString());
const num = (v: any): number => Number(v.toString());
const key = (v: any): string => (v as PublicKey).toBase58();
const variant = (v: any): string => Object.keys(v)[0].toLowerCase();

type AccountName = 'Config' | 'Service' | 'Team' | 'Spender' | 'Payment';

/** Decodes a program account, or null when it is not one of ours or not that type. */
function decode(name: AccountName, info: AccountInfo<Buffer> | null): any | null {
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  try {
    return coder.accounts.decode(name, info.data);
  } catch {
    return null;
  }
}

export function toConfig(address: string, info: AccountInfo<Buffer> | null): Config | null {
  const c = decode('Config', info);
  return c && { address, admin: key(c.admin), mint: key(c.mint), services: num(c.services) };
}

export function toService(address: string, info: AccountInfo<Buffer> | null): Service | null {
  const s = decode('Service', info);
  return (
    s && { address, id: s.id, label: s.label, payee: key(s.payee), payeeToken: key(s.payee_token), price: big(s.price), active: !!s.active }
  );
}

export function toTeam(address: string, info: AccountInfo<Buffer> | null): Team | null {
  const t = decode('Team', info);
  return (
    t && {
      address,
      owner: key(t.owner),
      mint: key(t.mint),
      vault: key(t.vault),
      name: t.name,
      paused: !!t.paused,
      spenders: num(t.spenders),
      payments: big(t.payments),
      paidCount: big(t.paid_count),
      paidTotal: big(t.paid_total),
      createdAt: num(t.created_at),
    }
  );
}

export function toSpender(address: string, info: AccountInfo<Buffer> | null): Spender | null {
  const s = decode('Spender', info);
  return (
    s && {
      address,
      team: key(s.team),
      authority: key(s.authority),
      kind: variant(s.kind) as Kind,
      label: s.label,
      status: variant(s.status) as SpenderStatus,
      generation: num(s.generation),
      policy: {
        allowance: big(s.policy.allowance),
        periodSecs: num(s.policy.period_secs),
        cap: big(s.policy.cap),
        maxPayments: num(s.policy.max_payments),
        expiresAt: num(s.policy.expires_at),
      },
      services: (s.services as PublicKey[]).map(key),
      periodStart: num(s.period_start),
      spent: big(s.spent),
      count: num(s.count),
      addedAt: num(s.added_at),
    }
  );
}

export function toPayment(address: string, info: AccountInfo<Buffer> | null): Payment | null {
  const p = decode('Payment', info);
  return (
    p && {
      address,
      team: key(p.team),
      spender: key(p.spender),
      authority: key(p.authority),
      kind: variant(p.kind) as Kind,
      service: key(p.service),
      payeeToken: key(p.payee_token),
      amount: big(p.amount),
      intent: p.intent,
      memo: p.memo,
      generation: num(p.generation),
      reasons: num(p.reasons),
      status: variant(p.status) as PaymentStatus,
      createdAt: num(p.created_at),
      deadline: num(p.deadline),
      decidedAt: num(p.decided_at),
      number: big(p.number),
    }
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ----------------------------------------------------------------------------------- reads ---

/** Program accounts of one type, optionally only one team's (team is at byte 8 in Spender and Payment). */
async function listAccounts(conn: Connection, name: AccountName, team?: string) {
  const filters: { memcmp: { offset: number; bytes: string } }[] = [{ memcmp: coder.accounts.memcmp(name) as { offset: number; bytes: string } }];
  if (team) filters.push({ memcmp: { offset: 8, bytes: team } });
  return conn.getProgramAccounts(PROGRAM_ID, { filters, commitment: 'confirmed' });
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null; // unknown, never zero
  }
}

export async function readConfig(conn: Connection): Promise<Config | null> {
  const address = pda.config();
  const info = await settle(conn.getAccountInfo(address, 'confirmed'));
  return info === null ? null : toConfig(address.toBase58(), info);
}

export async function readServices(conn: Connection): Promise<Service[] | null> {
  const rows = await settle(listAccounts(conn, 'Service'));
  if (!rows) return null;
  return rows
    .map((r) => toService(r.pubkey.toBase58(), r.account))
    .filter((s): s is Service => !!s)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readTokenBalance(conn: Connection, tokenAccount: string): Promise<bigint | null> {
  const r = await settle(conn.getTokenAccountBalance(new PublicKey(tokenAccount), 'confirmed'));
  if (!r || !/^\d+$/.test(r.value.amount)) return null;
  return BigInt(r.value.amount);
}

export async function readPayment(conn: Connection, address: string): Promise<Payment | null> {
  const info = await settle(conn.getAccountInfo(new PublicKey(address), 'confirmed'));
  return info ? toPayment(address, info) : null;
}

export async function readTeam(conn: Connection, address: string): Promise<Team | null> {
  const info = await settle(conn.getAccountInfo(new PublicKey(address), 'confirmed'));
  return info ? toTeam(address, info) : null;
}

export type TeamState = {
  /** null when the read failed; `missing` says the account is absent or not a Rein team. */
  team: Team | null;
  missing: boolean;
  config: Config | null;
  balance: bigint | null;
  spenders: Spender[] | null;
  payments: Payment[] | null;
  services: Service[] | null;
  slot: number | null;
  at: number;
};

export const emptyTeamState: TeamState = {
  team: null,
  missing: false,
  config: null,
  balance: null,
  spenders: null,
  payments: null,
  services: null,
  slot: null,
  at: 0,
};

/** Everything the team view shows, in two round trips. Each part that fails is null (unknown). */
export async function loadTeam(conn: Connection, address: string): Promise<TeamState> {
  const teamKey = new PublicKey(address);
  const [teamInfo, config, services, spenderRows, paymentRows, slot] = await Promise.all([
    conn.getAccountInfo(teamKey, 'confirmed').then(
      (i) => ({ ok: true as const, info: i }),
      () => ({ ok: false as const, info: null }),
    ),
    readConfig(conn),
    readServices(conn),
    settle(listAccounts(conn, 'Spender', address)),
    settle(listAccounts(conn, 'Payment', address)),
    settle(conn.getSlot('confirmed')),
  ]);
  const team = teamInfo.ok ? toTeam(address, teamInfo.info) : null;
  const missing = teamInfo.ok && team === null;
  const balance = team ? await readTokenBalance(conn, team.vault) : null;
  const spenders = spenderRows
    ? spenderRows
        .map((r) => toSpender(r.pubkey.toBase58(), r.account))
        .filter((s): s is Spender => !!s && s.team === address)
        .sort((a, b) => a.addedAt - b.addedAt || a.label.localeCompare(b.label))
    : null;
  const payments = paymentRows
    ? paymentRows
        .map((r) => toPayment(r.pubkey.toBase58(), r.account))
        .filter((p): p is Payment => !!p && p.team === address)
        .sort((a, b) => (b.number > a.number ? 1 : b.number < a.number ? -1 : 0))
    : null;
  return { team, missing, config, balance, spenders, payments, services, slot, at: Date.now() };
}

// ------------------------------------------------------------------------------ the policy ---

/** The period as the program would see it at `now`: rolled forward on schedule, never to "now". */
export function rolled(sp: Spender, now: number): { periodStart: number; spent: bigint; count: number } {
  const len = sp.policy.periodSecs;
  if (len > 0 && now >= sp.periodStart + len) {
    const periods = Math.floor((now - sp.periodStart) / len);
    return { periodStart: sp.periodStart + periods * len, spent: 0n, count: 0 };
  }
  return { periodStart: sp.periodStart, spent: sp.spent, count: sp.count };
}

/** What the spender can pay in one payment right now without asking, the remaining_of rule from the NEAR version. */
export function remainingOf(sp: Spender, now: number, teamPaused: boolean): bigint {
  if (teamPaused || sp.status !== 'active' || now >= sp.policy.expiresAt) return 0n;
  const r = rolled(sp, now);
  if (r.count >= sp.policy.maxPayments) return 0n;
  const left = sp.policy.allowance > r.spent ? sp.policy.allowance - r.spent : 0n;
  return left < sp.policy.cap ? left : sp.policy.cap;
}

/** The reasons a payment would go to the owner, as the program's bits. */
export function overLimits(sp: Spender, service: string, amount: bigint, now: number): number {
  const r = rolled(sp, now);
  let bits = 0;
  if (!sp.services.includes(service)) bits |= OVER_SERVICE;
  if (amount > sp.policy.cap) bits |= OVER_CAP;
  if (r.spent + amount > sp.policy.allowance) bits |= OVER_ALLOWANCE;
  if (r.count >= sp.policy.maxPayments) bits |= OVER_COUNT;
  return bits;
}

/** A pending payment the owner can still act on. */
export function isLive(p: Payment, now: number): boolean {
  return p.status === 'pending' && now < p.deadline;
}

// ------------------------------------------------------------------------------ validation ---

export function checkLabel(label: string): string | null {
  const n = enc.encode(label).length;
  return n >= 1 && n <= LABEL_MAX ? null : `a label of 1 to ${LABEL_MAX} bytes`;
}

export function checkIntent(intent: string): boolean {
  return intent.length >= 1 && intent.length <= INTENT_MAX && /^[A-Za-z0-9_-]+$/.test(intent);
}

/** Problems with a policy, in the program's terms. Empty means the program will accept it. */
export function policyProblems(p: Policy, now: number): string[] {
  const out: string[] = [];
  if (p.allowance <= 0n) out.push('an allowance above $0');
  if (p.cap <= 0n) out.push('a cap above $0');
  if (p.cap > p.allowance) out.push('a cap no higher than the allowance');
  if (p.periodSecs < MIN_PERIOD_SECS) out.push(`a period of at least ${MIN_PERIOD_SECS} s`);
  if (p.maxPayments < 1) out.push('at least 1 payment');
  if (p.expiresAt <= now) out.push('an expiry in the future');
  const U64 = (1n << 64n) - 1n;
  if (p.allowance > U64 || p.cap > U64) out.push('amounts that fit in a u64');
  return out;
}

export function newIntent(tag = 'web'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2);
  return `${tag}-${rand}`.slice(0, INTENT_MAX);
}

// ---------------------------------------------------------------------------- instructions ---

const bn = (v: bigint | number) => new BN(v.toString());
const pk = (s: string | PublicKey) => (typeof s === 'string' ? new PublicKey(s) : s);
const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

function ix(name: string, args: Record<string, unknown>, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: coder.instruction.encode(name, args) });
}

function policyArg(p: Policy) {
  return { allowance: bn(p.allowance), period_secs: p.periodSecs, cap: bn(p.cap), max_payments: p.maxPayments, expires_at: bn(p.expiresAt) };
}

export const ixs = {
  createTeam(a: { payer: PublicKey; owner: PublicKey; mint: string; name: string }) {
    const team = pda.team(a.owner);
    const mint = pk(a.mint);
    return ix('create_team', { name: a.name }, [
      w(a.payer, true),
      r(a.owner, true),
      r(pda.config()),
      r(mint),
      w(team),
      w(pda.vault(mint, team)),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ]);
  },

  addSpender(a: { payer: PublicKey; owner: PublicKey; authority: PublicKey; kind: Kind; label: string; policy: Policy; services: string[] }) {
    const team = pda.team(a.owner);
    return ix(
      'add_spender',
      {
        authority: a.authority,
        kind: a.kind === 'agent' ? { Agent: {} } : { Person: {} },
        label: a.label,
        policy: policyArg(a.policy),
        services: a.services.map(pk),
      },
      [w(a.payer, true), r(a.owner, true), w(team), w(pda.spender(team, a.authority)), r(SystemProgram.programId)],
    );
  },

  setPolicy(a: { owner: PublicKey; spender: string; policy: Policy }) {
    return ix('set_policy', { policy: policyArg(a.policy) }, [r(a.owner, true), r(pda.team(a.owner)), w(pk(a.spender))]);
  },

  setServices(a: { owner: PublicKey; spender: string; services: string[] }) {
    return ix('set_services', { services: a.services.map(pk) }, [r(a.owner, true), r(pda.team(a.owner)), w(pk(a.spender))]);
  },

  setSpenderStatus(a: { owner: PublicKey; spender: string; active: boolean }) {
    return ix('set_spender_status', { active: a.active }, [r(a.owner, true), r(pda.team(a.owner)), w(pk(a.spender))]);
  },

  revoke(a: { owner: PublicKey; spender: string }) {
    return ix('revoke', {}, [r(a.owner, true), r(pda.team(a.owner)), w(pk(a.spender))]);
  },

  setPaused(a: { owner: PublicKey; paused: boolean }) {
    return ix('set_paused', { paused: a.paused }, [r(a.owner, true), w(pda.team(a.owner))]);
  },

  withdraw(a: { owner: PublicKey; vault: string; to: string; amount: bigint }) {
    return ix('withdraw', { amount: bn(a.amount) }, [r(a.owner, true), r(pda.team(a.owner)), w(pk(a.vault)), w(pk(a.to)), r(TOKEN_PROGRAM_ID)]);
  },

  pay(a: { payer: PublicKey; authority: PublicKey; team: string; vault: string; service: Service; intent: string; amount: bigint; memo: string }) {
    const team = pk(a.team);
    const spender = pda.spender(team, a.authority);
    return ix('pay', { intent: a.intent, amount: bn(a.amount), memo: a.memo }, [
      w(a.payer, true),
      r(a.authority, true),
      w(team),
      w(spender),
      r(pk(a.service.address)),
      w(pk(a.vault)),
      w(pk(a.service.payeeToken)),
      w(pda.payment(spender, a.intent)),
      r(TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ]);
  },

  approve(a: { owner: PublicKey; team: Team; payment: Payment }) {
    return ix('approve', {}, [
      r(a.owner, true),
      w(pk(a.team.address)),
      w(pk(a.payment.spender)),
      r(pk(a.payment.service)),
      w(pk(a.team.vault)),
      w(pk(a.payment.payeeToken)),
      w(pk(a.payment.address)),
      r(TOKEN_PROGRAM_ID),
    ]);
  },

  decline(a: { owner: PublicKey; team: string; payment: string }) {
    return ix('decline', {}, [r(a.owner, true), r(pk(a.team)), w(pk(a.payment))]);
  },

  cancel(a: { signer: PublicKey; team: string; payment: string }) {
    return ix('cancel', {}, [r(a.signer, true), r(pk(a.team)), w(pk(a.payment))]);
  },
};

/** Instruction names by discriminator, for the sponsor's allow-list. */
export function instructionName(data: Uint8Array): string | null {
  try {
    const d = coder.instruction.decode(Buffer.from(data));
    return d ? d.name : null;
  } catch {
    return null;
  }
}

/** Maps a program error in a log or message to its text from the IDL. */
export function programErrorText(e: unknown): string | null {
  const s = String((e as { message?: string })?.message ?? e);
  if (/already in use/.test(s)) return 'this payment intent was already used: one intent pays once';
  const errors = (idlJson as { errors?: { code: number; name: string; msg?: string }[] }).errors ?? [];
  const hex = s.match(/custom program error: 0x([0-9a-f]+)/i);
  const code = hex ? parseInt(hex[1], 16) : null;
  const byCode = code !== null ? errors.find((x) => x.code === code) : undefined;
  if (byCode) return byCode.msg ?? byCode.name;
  const byName = errors.find((x) => s.includes(`Error Code: ${x.name}`));
  return byName ? byName.msg ?? byName.name : null;
}
