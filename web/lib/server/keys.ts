// Server-held keys. Each comes from an env var holding a JSON byte array, or for local dev from
// ~/.config/rein/<file>. A key is never logged, returned, or written anywhere by this app.
// Import only from route handlers (app/api/*), never from a client component.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';

const SOURCES = {
  sponsor: { env: 'REIN_SPONSOR_SECRET', file: 'sponsor.json' },
  demoOwner: { env: 'REIN_DEMO_OWNER_SECRET', file: 'demo-owner.json' },
  mintAuthority: { env: 'REIN_MINT_AUTHORITY_SECRET', file: 'mint-authority.json' },
  demoAgent: { env: 'REIN_DEMO_AGENT_SECRET', file: 'demo-agent.json' },
  /** The claim pool's token-account owner (scripts/pool-setup.ts). */
  pool: { env: 'REIN_POOL_SECRET', file: 'pool.json' },
} as const;

export type KeyName = keyof typeof SOURCES;

const cache = new Map<KeyName, Keypair | null>();

function parse(raw: string): Keypair | null {
  try {
    const bytes = JSON.parse(raw);
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return null;
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/** The keypair, or null when it is not configured or malformed (callers then refuse to act). */
export function serverKey(name: KeyName): Keypair | null {
  if (cache.has(name)) return cache.get(name)!;
  const { env, file } = SOURCES[name];
  let kp: Keypair | null = null;
  const fromEnv = process.env[env];
  if (fromEnv && fromEnv.trim()) {
    kp = parse(fromEnv);
  } else if (process.env.NODE_ENV !== 'production' || process.env.REIN_ALLOW_KEY_FILES === '1') {
    // Outside the project, read at runtime only; the ignore keeps the bundler from tracing the whole repo.
    const path = join(/*turbopackIgnore: true*/ process.env.REIN_KEYS_DIR || join(homedir(), '.config', 'rein'), file);
    if (existsSync(path)) {
      try {
        kp = parse(readFileSync(path, 'utf8'));
      } catch {
        kp = null;
      }
    }
  }
  cache.set(name, kp);
  return kp;
}
