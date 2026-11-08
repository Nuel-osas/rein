// The claim pool. 0.30 test USDC once per Privy user and once per wallet, into the vault of the team
// the user's embedded wallet owns: each Google account's $0.30 of AI compute, CLAIM_TOTAL_CAP claims
// in all (default 16). The pool key signs the transfer; the sponsor pays the fee.
//
//   GET  /api/claim?team=<team PDA>   the pool's balance from chain, claims taken, and, with a Privy
//                                     token, whether this user has claimed (and its signature)
//   POST /api/claim {team}            claim (Privy access token required)
//
// Fail closed: no Privy secret, no store, no pool key or an unreadable chain → refused, nothing sent.

import { PublicKey } from '@solana/web3.js';
import { parseAddress } from '@/lib/chain';
import { pda, readConfig } from '@/lib/rein';
import { CLAIM_UNITS, claim, claimStatus, claimsTaken, poolBalance, poolToken, totalCap } from '@/lib/server/claim';
import { allow, allowKey, tooMany } from '@/lib/server/limit';
import { privyConfigured, privySession, privySolanaWallets } from '@/lib/server/privy';
import { serverConnection } from '@/lib/server/send';
import { store, storeUnavailable } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

/** The signed-in user and the embedded wallet that owns `team`, or a refusal. */
async function owner(req: Request, team: string): Promise<{ userId: string; wallet: string } | Response> {
  if (!privyConfigured()) return fail('Sign-in is not configured on this server.', 503);
  const session = await privySession(req);
  if (session.kind === 'none') return fail('Sign in to claim.', 401);
  if (session.kind !== 'user') return fail('Your session has expired. Sign in again.', 401);
  const wallets = await privySolanaWallets(session.userId);
  if (wallets === null) return fail('Could not confirm your wallet with the sign-in service. Nothing was sent; try again.', 502);
  if (wallets.length === 0) return fail('Your account has no Solana wallet yet. Sign out and in again.', 403);
  // The team is the PDA of its owner; the caller's wallet must be that owner.
  const wallet = wallets.find((w) => pda.team(new PublicKey(w)).toBase58() === team);
  if (!wallet) return fail('That team is not owned by your signed-in wallet.', 403);
  return { userId: session.userId, wallet };
}

export async function GET(req: Request) {
  if (!allow('claim-get', req, 60, 60_000)) return tooMany();
  const team = parseAddress(new URL(req.url).searchParams.get('team'));
  const config = await readConfig(serverConnection());
  const pool = config ? poolToken(config.mint) : null;
  const balance = pool ? await poolBalance(pool.token) : null;
  const s = store();
  const base = {
    ok: true,
    configured: !!pool && !!s,
    pool: pool ? pool.token.toBase58() : null,
    /** base units as a string; null when unknown */
    balance: balance === null ? null : balance.toString(),
    amount: CLAIM_UNITS.toString(),
    cap: totalCap(),
    taken: s ? await claimsTaken(s) : null,
  };
  if (!team || !s || !req.headers.get('authorization')) return Response.json({ ...base, claimed: null, signedIn: false });
  const who = await owner(req, team);
  if (who instanceof Response) return Response.json({ ...base, claimed: null, signedIn: false });
  const mine = await claimStatus(s, who.userId, who.wallet);
  return Response.json({ ...base, claimed: mine.claimed, signature: mine.signature, signedIn: true });
}

export async function POST(req: Request) {
  let body: { team?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 512) return fail('request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return fail('bad json');
  }
  const team = parseAddress(typeof body?.team === 'string' ? body.team : null);
  if (!team) return fail('team must be a team account address');
  if (!allow('claim', req, 10, 60_000)) return tooMany();

  const s = store();
  if (!s) return storeUnavailable();
  const who = await owner(req, team);
  if (who instanceof Response) return who;
  if (!allowKey('claim', `user:${who.userId}`, 5, 60_000)) return tooMany();

  const r = await claim(s, { userId: who.userId, wallet: who.wallet, teamAddr: team });
  return Response.json(r.body, { status: r.http });
}
