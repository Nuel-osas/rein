// Privy sessions on the server. A request may carry `Authorization: Bearer <Privy access token>`;
// it is verified with @privy-io/node and PRIVY_APP_SECRET. Nothing here is logged or returned.
// Import only from route handlers.

import { PrivyClient } from '@privy-io/node';

let client: PrivyClient | null | undefined;

/** True when this server can verify Privy tokens (both the app id and the secret are set). */
export function privyConfigured(): boolean {
  return privy() !== null;
}

function privy(): PrivyClient | null {
  if (client !== undefined) return client;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const key = process.env.PRIVY_VERIFICATION_KEY?.trim();
  client = appId && appSecret ? new PrivyClient({ appId, appSecret, ...(key ? { jwtVerificationKey: key } : {}) }) : null;
  return client;
}

export type PrivySession =
  /** No token on the request: an anonymous caller. */
  | { kind: 'none' }
  /** A token we cannot check because this server has no Privy secret: treated as anonymous. */
  | { kind: 'unverifiable' }
  /** A token that failed verification (expired, forged, another app's): refused. */
  | { kind: 'invalid' }
  | { kind: 'user'; userId: string };

export async function privySession(req: Request): Promise<PrivySession> {
  const header = req.headers.get('authorization');
  const token = header?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { kind: 'none' };
  if (token.length > 4096) return { kind: 'invalid' };
  const p = privy();
  if (!p) return { kind: 'unverifiable' };
  try {
    const claims = await p.utils().auth().verifyAccessToken(token);
    return claims.user_id ? { kind: 'user', userId: claims.user_id } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * The user's Privy embedded Solana wallets, read from Privy's API (never from the client), or null
 * when the read fails or this server cannot ask (unknown, which callers refuse on).
 */
const walletCache = new Map<string, { wallets: string[]; at: number }>();

export async function privySolanaWallets(userId: string): Promise<string[] | null> {
  const p = privy();
  if (!p) return null;
  const hit = walletCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.wallets;
  try {
    const user = await p.users()._get(userId);
    const wallets = user.linked_accounts.flatMap((a) =>
      a.type === 'wallet' && 'chain_type' in a && a.chain_type === 'solana' && 'connector_type' in a && a.connector_type === 'embedded' && typeof a.address === 'string'
        ? [a.address]
        : [],
    );
    // A read with no wallet yet is not cached: Privy may still be creating it.
    if (wallets.length) {
      if (walletCache.size > 5_000) walletCache.clear();
      walletCache.set(userId, { wallets, at: Date.now() });
    }
    return wallets;
  } catch {
    return null;
  }
}
