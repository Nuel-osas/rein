'use client';

// The wallet: Privy. A person signs in with Google and Privy creates an embedded Solana wallet for
// them; that wallet signs, the server's sponsor co-signs as fee payer (and pays the rent of new
// accounts), so nobody needs SOL. One `send` builds, signs and confirms a transaction. A result
// that cannot be read is reported as pending, never failed, so nobody pays twice.
//
// Fail closed: without NEXT_PUBLIC_PRIVY_APP_ID there is no sign-in. Public views still render, and
// every action says sign-in is not configured instead of crashing.

import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MARK_PATH } from '@/components/brand-mark';
import { RPC_URL, connection } from './chain';
import { programErrorText } from './rein';

export type Sent = {
  signature: string | null;
  /** confirmed: landed. failed: the chain refused it, nothing moved. pending: unknown, check before retrying. */
  status: 'confirmed' | 'failed' | 'pending';
  error?: string;
};

type WalletCtx = {
  /** False when this deployment has no Privy app id: sign-in is off, public views still work. */
  configured: boolean;
  /** Privy has loaded and knows whether someone is signed in. */
  ready: boolean;
  authenticated: boolean;
  /** Who is signed in, for display: the Google name or email. */
  label: string | null;
  /** The signed-in person's embedded Solana wallet, once Privy has created it. */
  address: string | null;
  publicKey: PublicKey | null;
  /** Opens Privy's sign-in (Google). */
  signIn: () => void;
  disconnect: () => Promise<void>;
  /** The sponsor's address when the server runs one; null when the wallet pays its own fees. */
  sponsor: PublicKey | null;
  /** The account that pays fees and rent for a transaction from this wallet. */
  payer: PublicKey | null;
  send: (ixs: TransactionInstruction[]) => Promise<Sent>;
  /** Headers that prove the session to our own routes (a Privy access token), or none. */
  authHeaders: () => Promise<Record<string, string>>;
  error: string | null;
};

const Ctx = createContext<WalletCtx | null>(null);

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;

/** The websocket endpoint that goes with an RPC URL (a local validator listens on the next port). */
function wsUrl(http: string): string {
  try {
    const u = new URL(http);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port) u.port = String(Number(u.port) + 1);
    return u.toString();
  } catch {
    return 'wss://api.devnet.solana.com';
  }
}

function useSponsor(): PublicKey | null {
  const [sponsor, setSponsor] = useState<PublicKey | null>(null);
  useEffect(() => {
    fetch('/api/sponsor', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        try {
          setSponsor(j?.address ? new PublicKey(j.address) : null);
        } catch {
          setSponsor(null);
        }
      })
      .catch(() => setSponsor(null));
  }, []);
  return sponsor;
}

/** Polls the signature until it lands, fails, or the wait runs out (then: pending). */
export async function confirm(signature: string, timeoutMs = 45_000): Promise<Sent> {
  const conn = connection();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: false });
      const st = value[0];
      if (st?.err) return { signature, status: 'failed', error: chainErrorText(st.err) };
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { signature, status: 'confirmed' };
    } catch {
      // a failed read says nothing about the transaction; keep asking
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { signature, status: 'pending' };
}

export function chainErrorText(err: unknown): string {
  const custom = (err as { InstructionError?: [number, { Custom?: number } | string] })?.InstructionError?.[1];
  if (custom && typeof custom === 'object' && typeof custom.Custom === 'number') {
    return programErrorText(`custom program error: 0x${custom.Custom.toString(16)}`) ?? `program error ${custom.Custom}`;
  }
  return JSON.stringify(err).slice(0, 200);
}


const NOT_CONFIGURED = 'Sign-in is not configured on this deployment.';

/** Without a Privy app id: nobody can sign in, and every action says so. */
function Unconfigured({ children }: { children: React.ReactNode }) {
  const value = useMemo<WalletCtx>(
    () => ({
      configured: false,
      ready: true,
      authenticated: false,
      label: null,
      address: null,
      publicKey: null,
      signIn: () => {},
      disconnect: async () => {},
      sponsor: null,
      payer: null,
      send: async () => {
        throw new Error(NOT_CONFIGURED);
      },
      authHeaders: async () => ({}),
      error: NOT_CONFIGURED,
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Signed({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const [error, setError] = useState<string | null>(null);
  const { login } = useLogin({ onError: (e) => setError(e === 'exited_auth_flow' ? null : 'Sign-in did not complete. Try again.') });
  const sponsor = useSponsor();

  // The embedded wallet Privy created for this person (it is the only kind Rein offers).
  const linked = user?.linkedAccounts.find(
    (a): a is typeof a & { type: 'wallet'; address: string; chainType: string; walletClientType?: string } =>
      a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana',
  );
  const wallet = (linked && wallets.find((w) => w.address === linked.address)) || wallets[0] || null;
  const address = authenticated ? (wallet?.address ?? linked?.address ?? null) : null;
  const publicKey = useMemo(() => {
    try {
      return address ? new PublicKey(address) : null;
    } catch {
      return null;
    }
  }, [address]);
  const label = user?.google?.name ?? user?.google?.email ?? user?.email?.address ?? null;
  const payer = sponsor ?? publicKey;

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const token = authenticated ? await getAccessToken() : null;
      return token ? { authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [authenticated, getAccessToken]);

  const send = useCallback<WalletCtx['send']>(
    async (instructions) => {
      if (!authenticated) throw new Error('Sign in first.');
      if (!wallet || !publicKey) throw new Error(walletsReady ? 'Your Solana wallet is not ready yet. Try again in a moment.' : 'Loading your wallet…');
      const conn = connection();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const feePayer = sponsor ?? publicKey;
      const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);
      const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const { signedTransaction } = await signTransaction({
        transaction: new Uint8Array(unsigned),
        wallet,
        chain: 'solana:devnet',
        options: { uiOptions: { showWalletUIs: false } },
      });

      if (!sponsor) {
        // No sponsor: the wallet pays its own fee, which an embedded wallet with 0 SOL cannot.
        let signature: string;
        try {
          signature = await conn.sendRawTransaction(signedTransaction, { preflightCommitment: 'confirmed' });
        } catch (e) {
          return { signature: null, status: 'failed', error: errorText(e) };
        }
        return confirm(signature);
      }

      let res: Response;
      try {
        res = await fetch('/api/sponsor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ tx: Buffer.from(signedTransaction).toString('base64') }),
        });
      } catch {
        // The sponsor may or may not have sent it. Look at the team before trying again.
        return { signature: null, status: 'pending', error: 'No answer from the sponsor.' };
      }
      const body = (await res.json().catch(() => null)) as { signature?: string; error?: string; sent?: boolean } | null;
      if (!res.ok || !body?.signature) {
        if (body?.sent) return { signature: body.signature ?? null, status: 'pending' };
        return { signature: null, status: 'failed', error: body?.error ?? `sponsor refused (${res.status})` };
      }
      return confirm(body.signature);
    },
    [authenticated, wallet, publicKey, walletsReady, sponsor, signTransaction, authHeaders],
  );

  const value = useMemo<WalletCtx>(
    () => ({
      configured: true,
      ready,
      authenticated,
      label,
      address,
      publicKey,
      signIn: () => {
        setError(null);
        login({ loginMethods: ['google'] });
      },
      disconnect: async () => {
        await logout().catch(() => {});
      },
      sponsor,
      payer,
      send,
      authHeaders,
      error,
    }),
    [ready, authenticated, label, address, publicKey, login, logout, sponsor, payer, send, authHeaders, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Rein's logo for the top of Privy's modal: the mark on its purple tile and the name in white, drawn
 * as one SVG so it needs no hosted image. Privy replaces the element's `style`, so sizing lives in
 * the viewBox and the width and height attributes.
 */
const PRIVY_LOGO = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 56" width="140" height="56" role="img" aria-label="Rein">
    <rect x="0" y="0" width="56" height="56" rx="10" fill="#5B21B6" />
    <path transform="translate(9 9) scale(.38)" fill="#FFFFFF" fillRule="evenodd" d={MARK_PATH} />
    <text x="72" y="40" fill="#FFFFFF" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontSize="34" fontWeight="500" letterSpacing="-1">
      rein
    </text>
  </svg>
);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  useEffect(() => setOrigin(window.location.origin), []);
  const rpcs = useMemo(
    () => ({ 'solana:devnet': { rpc: createSolanaRpc(RPC_URL), rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl(RPC_URL)) } }),
    [],
  );
  if (!PRIVY_APP_ID) return <Unconfigured>{children}</Unconfigured>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['google'],
        appearance: {
          // Privy's dark scheme, derived from Rein's surface so the modal is purple-black, not blue-black.
          theme: '#131118',
          accentColor: '#5B21B6',
          logo: PRIVY_LOGO,
          landingHeader: 'Sign in to Rein',
          loginMessage: 'Spending rules for your team and its AI agents.',
          walletChainType: 'solana-only',
          showWalletLoginFirst: false,
        },
        embeddedWallets: { solana: { createOnLogin: 'all-users' }, ethereum: { createOnLogin: 'off' }, showWalletUIs: false },
        solana: { rpcs },
        // Privy's return into Rein after Google, derived from the browser so production never points at localhost.
        customOAuthRedirectUrl: origin ? `${origin}/auth/callback` : undefined,
      }}
    >
      <Signed>{children}</Signed>
    </PrivyProvider>
  );
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

/** Turns a wallet or chain error into one honest sentence. */
export function errorText(e: unknown): string {
  const s = String((e as { message?: string })?.message ?? e);
  const program = programErrorText(e);
  if (program) return program;
  if (/User rejected|rejected the request|cancel|declined/i.test(s)) return 'You closed the signing window. Nothing was sent.';
  if (/insufficient (funds|lamports)|Attempt to debit an account but found no record of a prior credit/i.test(s))
    return 'The fee payer has no SOL on this cluster. Nothing was sent.';
  return s.slice(0, 220);
}
