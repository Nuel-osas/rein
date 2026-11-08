// /stats, read live from the Rein program on the configured cluster.
//
// Every figure comes from `getProgramAccounts` filtered by an account discriminator (Anchor's first
// eight bytes), decoded with the program's IDL. Each account type is read on its own, so one failed
// read leaves only its own figures unknown (null), never zero, and never a figure from a guess.
// Money stays a bigint in base units until it leaves here, as a decimal string.
//
// The snapshot is cached per server instance for a minute (ten seconds when a read failed), so a
// busy page costs one set of reads a minute, not one a view.

import type {AccountInfo, PublicKey} from "@solana/web3.js";
import {PROGRAM_ID, connection} from "@/lib/chain";
import {coder, toPayment, toService, toSpender, toTeam, type Payment, type Service, type Spender, type Team} from "@/lib/rein";

type AccountName = "Team" | "Spender" | "Payment" | "Service";

export interface LatestPayment {
  /** The Payment record's address: its explorer page shows every transaction that touched it. */
  address: string;
  /** The service's registry id, or null when the service account was not read. */
  service: string | null;
  kind: "person" | "agent";
  team: string | null;
  /** Settled after the owner approved it, rather than inside the policy at once. */
  viaApproval: boolean;
  /** USDC base units, as a decimal string. */
  amount: string;
  /** Unix seconds: when it was paid (filed), or when the owner's approval settled it. */
  at: number;
}

export interface ApprovalSplit {
  /** Payments the rules filed for the owner instead of paying. */
  filed: number;
  /** Approved, and settled in the same transaction. */
  settled: number;
  declined: number;
  /** A stop applied at approval time (revoked, re-granted, expired, paused). Final. */
  refused: number;
  /** Withdrawn by the spender that filed it. */
  cancelled: number;
  /** Still pending, inside its deadline. */
  waiting: number;
  /** Still pending, past its deadline: it can no longer be approved. */
  expired: number;
}

export interface StatsSnapshot {
  /** Milliseconds, when the reads finished. */
  readAt: number;
  /** The slot the cluster reported alongside the reads, or null. */
  slot: number | null;
  teams: number | null;
  spenders: {total: number | null; people: number | null; agents: number | null};
  payments: {
    /** Payment records of any status. */
    records: number | null;
    /** Paid at once or settled after an approval. */
    settled: number | null;
    viaApproval: number | null;
    byAgents: number | null;
    /** USDC base units moved by settled payments, as a decimal string. */
    amount: string | null;
  };
  services: {total: number | null; active: number | null};
  approvals: ApprovalSplit | null;
  latest: LatestPayment[] | null;
}

async function accounts(name: AccountName): Promise<{pubkey: PublicKey; account: AccountInfo<Buffer>}[] | null> {
  try {
    const memcmp = coder.accounts.memcmp(name) as {offset: number; bytes: string};
    const list = await connection().getProgramAccounts(PROGRAM_ID, {commitment: "confirmed", filters: [{memcmp}]});
    return [...list];
  } catch {
    return null; // unknown, never zero
  }
}

/** Decodes every account, or null when the read failed or any account would not decode. */
function decodeAll<T>(list: {pubkey: PublicKey; account: AccountInfo<Buffer>}[] | null, decode: (a: string, i: AccountInfo<Buffer>) => T | null): T[] | null {
  if (!list) return null;
  const out: T[] = [];
  for (const {pubkey, account} of list) {
    const value = decode(pubkey.toBase58(), account);
    if (!value) return null; // one record we cannot read makes every total from this type unknown
    out.push(value);
  }
  return out;
}

const SETTLED = new Set<Payment["status"]>(["paid", "settled"]);

export function summarise(input: {
  teams: Team[] | null;
  spenders: Spender[] | null;
  payments: Payment[] | null;
  services: Service[] | null;
  slot: number | null;
  now: number;
}): StatsSnapshot {
  const {teams, spenders, payments, services, slot, now} = input;
  const nowSecs = Math.floor(now / 1000);

  let paymentFigures: StatsSnapshot["payments"] = {records: null, settled: null, viaApproval: null, byAgents: null, amount: null};
  let approvals: ApprovalSplit | null = null;
  let latest: LatestPayment[] | null = null;

  if (payments) {
    const done = payments.filter((p) => SETTLED.has(p.status));
    const amount = done.reduce((sum, p) => sum + p.amount, 0n);
    paymentFigures = {
      records: payments.length,
      settled: done.length,
      viaApproval: done.filter((p) => p.status === "settled").length,
      byAgents: done.filter((p) => p.kind === "agent").length,
      amount: amount.toString(),
    };

    const filed = payments.filter((p) => p.status !== "paid");
    const pending = filed.filter((p) => p.status === "pending");
    approvals = {
      filed: filed.length,
      settled: filed.filter((p) => p.status === "settled").length,
      declined: filed.filter((p) => p.status === "declined").length,
      refused: filed.filter((p) => p.status === "refused").length,
      cancelled: filed.filter((p) => p.status === "cancelled").length,
      waiting: pending.filter((p) => p.deadline > nowSecs).length,
      expired: pending.filter((p) => p.deadline <= nowSecs).length,
    };

    const serviceId = new Map((services ?? []).map((s) => [s.address, s.id]));
    const teamName = new Map((teams ?? []).map((t) => [t.address, t.name]));
    latest = done
      .map((p) => ({
        address: p.address,
        service: serviceId.get(p.service) ?? null,
        kind: p.kind,
        team: teamName.get(p.team) ?? null,
        viaApproval: p.status === "settled",
        amount: p.amount.toString(),
        at: p.status === "settled" && p.decidedAt > 0 ? p.decidedAt : p.createdAt,
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 8);
  }

  return {
    readAt: now,
    slot,
    teams: teams ? teams.length : null,
    spenders: spenders
      ? {total: spenders.length, people: spenders.filter((s) => s.kind === "person").length, agents: spenders.filter((s) => s.kind === "agent").length}
      : {total: null, people: null, agents: null},
    payments: paymentFigures,
    services: services ? {total: services.length, active: services.filter((s) => s.active).length} : {total: null, active: null},
    approvals,
    latest,
  };
}

async function readNow(): Promise<StatsSnapshot> {
  const [teamList, spenderList, paymentList, serviceList, slot] = await Promise.all([
    accounts("Team"),
    accounts("Spender"),
    accounts("Payment"),
    accounts("Service"),
    connection()
      .getSlot("confirmed")
      .catch(() => null),
  ]);
  return summarise({
    teams: decodeAll(teamList, toTeam),
    spenders: decodeAll(spenderList, toSpender),
    payments: decodeAll(paymentList, toPayment),
    services: decodeAll(serviceList, toService),
    slot,
    now: Date.now(),
  });
}

function complete(s: StatsSnapshot): boolean {
  return s.teams !== null && s.spenders.total !== null && s.payments.records !== null && s.services.total !== null;
}

let cached: {at: number; value: Promise<StatsSnapshot>} | null = null;

/** The snapshot, at most a minute old (ten seconds when a read failed). */
export async function networkStats(): Promise<StatsSnapshot> {
  const now = Date.now();
  if (cached && now - cached.at < 10_000) return cached.value;
  if (cached && now - cached.at < 60_000) {
    const value = await cached.value;
    if (complete(value)) return value;
  }
  const value = readNow();
  cached = {at: now, value};
  return value;
}
