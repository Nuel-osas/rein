'use client';

// The wallet: Solana wallet-adapter with wallet-standard auto-detect, so Phantom, Solflare,
// Backpack and any other standard wallet appear without being listed here. On top of it, one
// `send` that builds, signs and confirms a transaction. When the server runs a sponsor, the sponsor
// pays the fee (and the rent of new accounts), so nobody needs SOL. A result that cannot be read is
// reported as pending, never failed, so nobody pays twice.

import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider as AdapterProvider, useWallet as useAdapter } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { RPC_URL, connection } from './chain';
import { programErrorText } from './rein';

export type Sent = {
  signature: string | null;
  /** confirmed: landed. failed: the chain refused it, nothing moved. pending: unknown, check before retrying. */
  status: 'confirmed' | 'failed' | 'pending';
  error?: string;
};

export type WalletOption = { name: string; icon: string; installed: boolean; url: string };

type WalletCtx = {
  address: string | null;
  publicKey: PublicKey | null;
  ready: boolean;
  connecting: boolean;
  wallets: WalletOption[];
  connect: (name: string) => void;
  disconnect: () => Promise<void>;
  /** The sponsor's address when the server runs one; null when the wallet pays its own fees. */
  sponsor: PublicKey | null;
  /** The account that pays fees and rent for a transaction from this wallet. */
  payer: PublicKey | null;
  send: (ixs: TransactionInstruction[]) => Promise<Sent>;
  /** Like send, but the wallet pays its own fee (for instructions the sponsor will not cover). */
  sendOwnFee: (ixs: TransactionInstruction[]) => Promise<Sent>;
  error: string | null;
};

const Ctx = createContext<WalletCtx | null>(null);

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

const INSTALL: Record<string, string> = {
  Phantom: 'https://phantom.com/download',
  Solflare: 'https://solflare.com/download',
  Backpack: 'https://backpack.app/download',
};

function Inner({ children }: { children: React.ReactNode }) {
  const a = useAdapter();
  const [sponsor, setSponsor] = useState<PublicKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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

  const wallets = useMemo<WalletOption[]>(() => {
    const seen = new Map<string, WalletOption>();
    for (const w of a.wallets) {
      const installed = w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
      if (w.readyState === WalletReadyState.Unsupported) continue;
      seen.set(w.adapter.name, { name: w.adapter.name, icon: w.adapter.icon, installed, url: w.adapter.url });
    }
    for (const name of ['Phantom', 'Solflare', 'Backpack']) {
      if (!seen.has(name)) seen.set(name, { name, icon: '', installed: false, url: INSTALL[name] });
    }
    return [...seen.values()].sort((x, y) => Number(y.installed) - Number(x.installed));
  }, [a.wallets]);

  const connect = useCallback(
    (name: string) => {
      setError(null);
      // autoConnect connects as soon as the selection lands.
      a.select(name as WalletName);
    },
    [a],
  );

  const disconnect = useCallback(async () => {
    await a.disconnect().catch(() => {});
  }, [a]);

  const payer = sponsor ?? a.publicKey ?? null;

  const sendWith = useCallback(
    async (instructions: TransactionInstruction[], sponsored: boolean): Promise<Sent> => {
      if (!a.publicKey) throw new Error('Connect a wallet first.');
      const conn = connection();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const sponsor_ = sponsored ? sponsor : null;
      const feePayer = sponsor_ ?? a.publicKey;
      const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);

      if (sponsor_) {
        if (!a.signTransaction) throw new Error('This wallet cannot sign without sending. Use another wallet.');
        const signed = await a.signTransaction(tx);
        const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
        let res: Response;
        try {
          res = await fetch('/api/sponsor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: Buffer.from(raw).toString('base64') }),
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
      }

      const signature = await a.sendTransaction(tx, conn, { preflightCommitment: 'confirmed' });
      return confirm(signature);
    },
    [a, sponsor],
  );
  const send = useCallback<WalletCtx['send']>((ixs) => sendWith(ixs, true), [sendWith]);
  const sendOwnFee = useCallback<WalletCtx['sendOwnFee']>((ixs) => sendWith(ixs, false), [sendWith]);

  const value = useMemo<WalletCtx>(
    () => ({
      address: a.publicKey?.toBase58() ?? null,
      publicKey: a.publicKey ?? null,
      ready: mounted && !a.connecting,
      connecting: a.connecting,
      wallets,
      connect,
      disconnect,
      sponsor,
      payer,
      send,
      sendOwnFee,
      error,
    }),
    [a.publicKey, a.connecting, mounted, wallets, connect, disconnect, sponsor, payer, send, sendOwnFee, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <AdapterProvider wallets={[]} autoConnect onError={(e) => setError(e.message || e.name)}>
        <ErrorBridge error={error}>
          <Inner>{children}</Inner>
        </ErrorBridge>
      </AdapterProvider>
    </ConnectionProvider>
  );
}

const ErrorCtx = createContext<string | null>(null);
function ErrorBridge({ error, children }: { error: string | null; children: React.ReactNode }) {
  return <ErrorCtx.Provider value={error}>{children}</ErrorCtx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  const adapterError = useContext(ErrorCtx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return adapterError && !v.error ? { ...v, error: adapterError } : v;
}

/** Turns a wallet or chain error into one honest sentence. */
export function errorText(e: unknown): string {
  const s = String((e as { message?: string })?.message ?? e);
  const program = programErrorText(e);
  if (program) return program;
  if (/User rejected|rejected the request|cancel|declined/i.test(s)) return 'You closed the wallet. Nothing was sent.';
  if (/insufficient (funds|lamports)|Attempt to debit an account but found no record of a prior credit/i.test(s))
    return 'The fee payer has no SOL on this cluster. Nothing was sent.';
  return s.slice(0, 220);
}
