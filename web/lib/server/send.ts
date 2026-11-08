// Sends a transaction signed by server keys and waits for it. A send whose fate is unknown is
// reported as pending with its signature, never as failed.

import { utils } from '@coral-xyz/anchor';
import { Connection, Transaction, type Keypair, type TransactionInstruction } from '@solana/web3.js';
import { RPC_URL } from '@/lib/chain';
import { programErrorText } from '@/lib/rein';

let conn: Connection | null = null;
/** The server's RPC: REIN_RPC_URL when set (a private endpoint), else the public one. */
export function serverConnection(): Connection {
  if (!conn) conn = new Connection(process.env.REIN_RPC_URL || RPC_URL, { commitment: 'confirmed' });
  return conn;
}

export type ServerSent = { signature: string | null; status: 'confirmed' | 'failed' | 'pending'; error?: string };

export async function waitFor(signature: string, timeoutMs = 30_000): Promise<ServerSent> {
  const c = serverConnection();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const { value } = await c.getSignatureStatuses([signature]);
      const st = value[0];
      if (st?.err) {
        const custom = (st.err as { InstructionError?: [number, { Custom?: number }] })?.InstructionError?.[1]?.Custom;
        const text = typeof custom === 'number' ? programErrorText(`custom program error: 0x${custom.toString(16)}`) : null;
        return { signature, status: 'failed', error: text ?? JSON.stringify(st.err).slice(0, 200) };
      }
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { signature, status: 'confirmed' };
    } catch {
      // keep asking
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { signature, status: 'pending' };
}

/** Signs with `signers` (the first pays the fee), sends with preflight, and waits. */
export async function sendSigned(ixs: TransactionInstruction[], signers: Keypair[]): Promise<ServerSent> {
  const c = serverConnection();
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  return broadcast(tx.serialize(), utils.bytes.bs58.encode(tx.signature!));
}

/** Sends a fully signed transaction. A preflight refusal is failed (nothing was broadcast); any other
 * error leaves the transaction's fate unknown, so it is pending under its known signature. */
export async function broadcast(raw: Uint8Array | Buffer, signature: string, wait = true): Promise<ServerSent> {
  const c = serverConnection();
  try {
    await c.sendRawTransaction(raw, { preflightCommitment: 'confirmed', maxRetries: 3 });
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs;
    const msg = String((e as Error)?.message ?? e);
    if (logs || /simulation failed|preflight|blockhash not found|invalid|signature verification/i.test(msg)) {
      const text = programErrorText(logs?.join('\n') ?? '') ?? programErrorText(e) ?? msg.slice(0, 200);
      return { signature: null, status: 'failed', error: text };
    }
    return { signature, status: 'pending', error: 'The send did not answer; check the signature before retrying.' };
  }
  return wait ? waitFor(signature) : { signature, status: 'pending' };
}
