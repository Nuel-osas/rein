import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';

/** Parses a Solana secret key written as a JSON array of 64 bytes. Never logs it. */
export function keypairFromJson(json: string, what: string): Keypair {
  let bytes: unknown;
  try {
    bytes = JSON.parse(json);
  } catch {
    throw new Error(`${what} is not JSON`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error(`${what} must be a JSON array of 64 bytes`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/** Reads a key from an env var (JSON byte array), or from a file under ~/.config/rein. */
export function loadKeypair(envVar: string, fallbackFile: string): Keypair {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) return keypairFromJson(fromEnv, envVar);
  const path = join(homedir(), '.config', 'rein', fallbackFile);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`set ${envVar} or create ${path}`);
  }
  return keypairFromJson(text, path);
}
