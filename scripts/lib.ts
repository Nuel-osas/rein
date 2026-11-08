// Shared helpers for Rein's scripts: keys, PDAs and the program client.
// Keys live in ~/.config/rein (never in the repo). The admin is the Solana CLI wallet.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import idl from '../idl/rein.json';
import type { Rein } from '../idl/rein';

export const PROGRAM_ID = new PublicKey(idl.address);
export const KEYS_DIR = process.env.REIN_KEYS_DIR ?? join(homedir(), '.config', 'rein');
export const U = 1_000_000n; // USDC has 6 decimals

export function rpcUrl(): string {
  return process.env.REIN_RPC_URL ?? 'http://127.0.0.1:8999';
}

export function cluster(): 'localnet' | 'devnet' {
  const c = process.env.REIN_CLUSTER ?? 'localnet';
  if (c !== 'localnet' && c !== 'devnet') throw new Error(`REIN_CLUSTER must be localnet or devnet, got ${c}`);
  return c;
}

export function readKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

/** Loads ~/.config/rein/<name>.json, creating it (mode 600) the first time. */
export function key(name: string): Keypair {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const file = join(KEYS_DIR, `${name}.json`);
  if (!existsSync(file)) {
    const kp = Keypair.generate();
    writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  return readKeypair(file);
}

export function adminKey(): Keypair {
  return readKeypair(process.env.REIN_ADMIN_KEYPAIR ?? join(homedir(), '.config', 'solana', 'id.json'));
}

export function client(conn: Connection, payer: Keypair): Program<Rein> {
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: 'confirmed' });
  return new Program<Rein>(idl as Rein, provider);
}

const seed = (s: string) => Buffer.from(s);

export const pda = {
  config: () => PublicKey.findProgramAddressSync([seed('config')], PROGRAM_ID)[0],
  service: (id: string) => PublicKey.findProgramAddressSync([seed('service'), seed(id)], PROGRAM_ID)[0],
  team: (owner: PublicKey) => PublicKey.findProgramAddressSync([seed('team'), owner.toBuffer()], PROGRAM_ID)[0],
  spender: (team: PublicKey, authority: PublicKey) =>
    PublicKey.findProgramAddressSync([seed('spender'), team.toBuffer(), authority.toBuffer()], PROGRAM_ID)[0],
  payment: (spender: PublicKey, intent: string) =>
    PublicKey.findProgramAddressSync([seed('payment'), spender.toBuffer(), seed(intent)], PROGRAM_ID)[0],
  vault: (mint: PublicKey, team: PublicKey) => getAssociatedTokenAddressSync(mint, team, true),
};

export const REASONS: Record<number, string> = {
  1: 'service_not_allowed',
  2: 'over_cap',
  4: 'over_allowance',
  8: 'over_payment_count',
};

export function decodeReasons(bits: number): string[] {
  return Object.entries(REASONS)
    .filter(([bit]) => (bits & Number(bit)) !== 0)
    .map(([, name]) => name);
}

/** "12.5" -> 12_500_000n. Rejects more than 6 decimals, signs and garbage. */
export function usdc(amount: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new Error(`not a USDC amount: ${amount}`);
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * U + BigInt(frac.padEnd(6, '0'));
}

export function fmt(base: bigint | null): string {
  if (base === null) return '—';
  const whole = base / U;
  const frac = (base % U).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function deployFile(): string {
  return join(__dirname, '..', 'deploy', `${cluster()}.json`);
}

export function explorer(kind: 'tx' | 'address', id: string): string {
  const c = cluster() === 'devnet' ? '?cluster=devnet' : `?cluster=custom&customUrl=${encodeURIComponent(rpcUrl())}`;
  return `https://explorer.solana.com/${kind}/${id}${c}`;
}
