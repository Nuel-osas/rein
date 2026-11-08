import { createHash } from 'node:crypto';
import { BN } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import type { Policy, SpenderStatus, SpenderView } from './budget.ts';
import { coder, IDL_PROGRAM_ID } from './idl.ts';

// Verified against @solana/spl-token 0.4 constants, the `address` fields in idl/rein.json, and the
// seeded localnet vault (test/chain.test.ts derives FT8E… from team EWuQ… and mint 2MzD…).
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
/** Matches `check_service_id` in the program. */
export const SERVICE_ID_RE = /^[a-z0-9-]{1,32}$/;
const MAX_SEED = 32;

const enc = (s: string) => Buffer.from(s, 'utf8');

export function bnToBig(v: BN | number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v.toString());
}

function bnToSafeNumber(v: BN | number): number {
  const n = typeof v === 'number' ? v : Number(BigInt(v.toString()));
  if (!Number.isSafeInteger(n)) throw new RangeError(`value out of safe range: ${v.toString()}`);
  return n;
}

function variant(e: Record<string, unknown>): string {
  const k = Object.keys(e)[0];
  if (!k) throw new Error('empty enum');
  return k;
}

export interface ConfigAccount {
  admin: PublicKey;
  mint: PublicKey;
  services: number;
}

export interface ServiceAccount {
  address: PublicKey;
  id: string;
  label: string;
  payee: PublicKey;
  payeeToken: PublicKey;
  price: bigint;
  active: boolean;
}

export interface TeamAccount {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  name: string;
  paused: boolean;
  payments: bigint;
}

export interface SpenderAccount extends SpenderView {
  address: PublicKey;
  team: PublicKey;
  authority: PublicKey;
  kind: string;
  label: string;
  generation: number;
  services: PublicKey[];
}

export type PaymentStatusName = 'Paid' | 'Pending' | 'Settled' | 'Declined' | 'Cancelled' | 'Refused';

export interface PaymentAccount {
  address: PublicKey;
  team: PublicKey;
  spender: PublicKey;
  authority: PublicKey;
  service: PublicKey;
  payeeToken: PublicKey;
  amount: bigint;
  intent: string;
  memo: string;
  reasons: number;
  status: PaymentStatusName;
  createdAt: number;
  deadline: number;
  number: bigint;
}

/**
 * Reads and addresses for one Rein deployment. Readers return null when the account does not
 * exist and throw when the read itself failed, so callers can tell "missing" from "unknown".
 */
export class ReinChain {
  readonly connection: Connection;
  readonly programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey = IDL_PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
  }

  private find(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  configPda(): PublicKey {
    return this.find([enc('config')]);
  }

  /**
   * The Service PDA for an id, exactly as the program derives it (`["service", id]`).
   * An id longer than a seed allows can never be registered, so it gets a stand-in address
   * (`["service", sha256(id)]`) that no account will ever occupy; `placeholder` says so.
   */
  servicePda(id: string): { address: PublicKey; placeholder: boolean } {
    const bytes = enc(id);
    if (bytes.length >= 1 && bytes.length <= MAX_SEED) return { address: this.find([enc('service'), bytes]), placeholder: false };
    return { address: this.find([enc('service'), createHash('sha256').update(bytes).digest()]), placeholder: true };
  }

  teamPda(owner: PublicKey): PublicKey {
    return this.find([enc('team'), owner.toBuffer()]);
  }

  spenderPda(team: PublicKey, authority: PublicKey): PublicKey {
    return this.find([enc('spender'), team.toBuffer(), authority.toBuffer()]);
  }

  paymentPda(spender: PublicKey, intent: string): PublicKey {
    return this.find([enc('payment'), spender.toBuffer(), enc(intent)]);
  }

  /** The team's vault: its associated token account for the mint (owner off curve). */
  static vaultAddress(team: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [team.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
  }

  private async raw(address: PublicKey): Promise<Buffer | null> {
    const info = await this.connection.getAccountInfo(address, 'confirmed');
    if (!info) return null;
    if (!info.owner.equals(this.programId)) {
      throw new Error(`${address.toBase58()} is not owned by the Rein program`);
    }
    return info.data;
  }

  async config(): Promise<ConfigAccount | null> {
    const data = await this.raw(this.configPda());
    if (!data) return null;
    const c = coder.accounts.decode('Config', data);
    return { admin: c.admin, mint: c.mint, services: c.services };
  }

  static decodeService(address: PublicKey, data: Buffer): ServiceAccount {
    const s = coder.accounts.decode('Service', data);
    return {
      address,
      id: s.id,
      label: s.label,
      payee: s.payee,
      payeeToken: s.payee_token,
      price: bnToBig(s.price),
      active: s.active,
    };
  }

  async service(id: string): Promise<ServiceAccount | null> {
    const { address, placeholder } = this.servicePda(id);
    if (placeholder) return null;
    const data = await this.raw(address);
    return data ? ReinChain.decodeService(address, data) : null;
  }

  async services(): Promise<ServiceAccount[]> {
    const disc = coder.accounts.memcmp('Service');
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: disc.offset ?? 0, bytes: disc.bytes! } }],
    });
    return accounts
      .map((a) => ReinChain.decodeService(a.pubkey, a.account.data))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  static decodeTeam(address: PublicKey, data: Buffer): TeamAccount {
    const t = coder.accounts.decode('Team', data);
    return {
      address,
      owner: t.owner,
      mint: t.mint,
      vault: t.vault,
      name: t.name,
      paused: t.paused,
      payments: bnToBig(t.payments),
    };
  }

  async team(address: PublicKey): Promise<TeamAccount | null> {
    const data = await this.raw(address);
    return data ? ReinChain.decodeTeam(address, data) : null;
  }

  static decodeSpender(address: PublicKey, data: Buffer): SpenderAccount {
    const s = coder.accounts.decode('Spender', data);
    const policy: Policy = {
      allowance: bnToBig(s.policy.allowance),
      periodSecs: s.policy.period_secs,
      cap: bnToBig(s.policy.cap),
      maxPayments: s.policy.max_payments,
      expiresAt: bnToSafeNumber(s.policy.expires_at),
    };
    return {
      address,
      team: s.team,
      authority: s.authority,
      kind: variant(s.kind),
      label: s.label,
      status: variant(s.status) as SpenderStatus,
      generation: s.generation,
      policy,
      services: s.services,
      periodStart: bnToSafeNumber(s.period_start),
      spent: bnToBig(s.spent),
      count: s.count,
    };
  }

  async spender(team: PublicKey, authority: PublicKey): Promise<SpenderAccount | null> {
    const address = this.spenderPda(team, authority);
    const data = await this.raw(address);
    return data ? ReinChain.decodeSpender(address, data) : null;
  }

  static decodePayment(address: PublicKey, data: Buffer): PaymentAccount {
    const p = coder.accounts.decode('Payment', data);
    return {
      address,
      team: p.team,
      spender: p.spender,
      authority: p.authority,
      service: p.service,
      payeeToken: p.payee_token,
      amount: bnToBig(p.amount),
      intent: p.intent,
      memo: p.memo,
      reasons: p.reasons,
      status: variant(p.status) as PaymentStatusName,
      createdAt: bnToSafeNumber(p.created_at),
      deadline: bnToSafeNumber(p.deadline),
      number: bnToBig(p.number),
    };
  }

  async payment(address: PublicKey): Promise<PaymentAccount | null> {
    const data = await this.raw(address);
    return data ? ReinChain.decodePayment(address, data) : null;
  }

  /** Unix seconds by the cluster's clock, falling back to this machine's clock if it can't be read. */
  async now(): Promise<{ now: number; source: 'cluster' | 'local' }> {
    try {
      const slot = await this.connection.getSlot('confirmed');
      const t = await this.connection.getBlockTime(slot);
      if (t !== null) return { now: t, source: 'cluster' };
    } catch {
      // fall through to the local clock
    }
    return { now: Math.floor(Date.now() / 1000), source: 'local' };
  }
}
