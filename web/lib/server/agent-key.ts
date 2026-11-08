// The agent key for a team, derived on the server so no per-team secret has to be stored:
//   seed = HMAC-SHA256(key = REIN_AGENT_SEED as UTF-8, msg = "rein.agent.v1" || team pubkey (32 bytes))
//   agent = Keypair.fromSeed(seed[0..32])
// The secret key never leaves this module's callers; GET /api/agent/key returns only the public key.
// Import only from route handlers.

import { createHmac } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

export const AGENT_KEY_DOMAIN = 'rein.agent.v1';

export function deriveAgentKey(seed: string, team: PublicKey): Keypair {
  const mac = createHmac('sha256', Buffer.from(seed, 'utf8'))
    .update(Buffer.concat([Buffer.from(AGENT_KEY_DOMAIN, 'utf8'), team.toBuffer()]))
    .digest();
  return Keypair.fromSeed(mac.subarray(0, 32));
}

/** The team's agent key, or null when REIN_AGENT_SEED is missing or too short (callers answer 503). */
export function agentKeyFor(team: string): Keypair | null {
  const seed = process.env.REIN_AGENT_SEED?.trim();
  if (!seed || seed.length < 32) return null;
  return deriveAgentKey(seed, new PublicKey(team));
}
