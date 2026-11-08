import { BN, utils } from '@coral-xyz/anchor';
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  type TransactionError,
} from '@solana/web3.js';
import { ReinChain, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, type PaymentAccount } from './chain.ts';
import { decodeTxError, describeError, isProgramRefusal, type DecodedError } from './errors.ts';
import { coder } from './idl.ts';
import { isValidIntent, makeIntent } from './intent.ts';
import { decodeReasons } from './reasons.ts';

export const MEMO_MAX = 64;

export type PayStatus = 'paid' | 'pending' | 'refused' | 'failed';

export interface PayOutcome {
  status: PayStatus;
  serviceId: string;
  amount: bigint;
  intent: string;
  /** The payment record's address (derived from spender and intent). */
  payment?: PublicKey;
  signature?: string;
  /** Pending only: why the program filed it for the owner. */
  reasons?: string[];
  /** Pending only: the owner can approve until this unix time. */
  deadline?: number;
  /** True when the send went out but no confirmation came back. Never retry these. */
  unconfirmed?: boolean;
  error?: DecodedError;
  /** True when the service id has no Service account on chain. */
  unknownService?: boolean;
}

export interface PayParams {
  chain: ReinChain;
  team: PublicKey;
  agent: Keypair;
  sponsor: Keypair;
  serviceId: string;
  amount: bigint;
  memo: string;
  intent?: string;
  /** How long to keep checking for confirmation. */
  confirmTimeoutMs?: number;
  pollMs?: number;
}

/** Cuts a memo to the program's 64 bytes without splitting a character. */
export function clampMemo(memo: string): string {
  let out = '';
  for (const ch of memo) {
    if (Buffer.byteLength(out + ch) > MEMO_MAX) break;
    out += ch;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clientError(message: string): DecodedError {
  return { code: null, name: 'ClientError', message, source: 'client' };
}

/** Builds the `pay` instruction with accounts in the order the IDL lists them. */
export function buildPayIx(a: {
  programId: PublicKey;
  payer: PublicKey;
  authority: PublicKey;
  team: PublicKey;
  spender: PublicKey;
  service: PublicKey;
  vault: PublicKey;
  payeeToken: PublicKey;
  payment: PublicKey;
  intent: string;
  amount: bigint;
  memo: string;
}): TransactionInstruction {
  const data = coder.instruction.encode('pay', {
    intent: a.intent,
    amount: new BN(a.amount.toString()),
    memo: a.memo,
  });
  const keys = [
    { pubkey: a.payer, isSigner: true, isWritable: true },
    { pubkey: a.authority, isSigner: true, isWritable: false },
    { pubkey: a.team, isSigner: false, isWritable: true },
    { pubkey: a.spender, isSigner: false, isWritable: true },
    { pubkey: a.service, isSigner: false, isWritable: false },
    { pubkey: a.vault, isSigner: false, isWritable: true },
    { pubkey: a.payeeToken, isSigner: false, isWritable: true },
    { pubkey: a.payment, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: a.programId, keys, data });
}

/** Turns the payment record into an outcome. Anything but Paid or Pending is not a clean result. */
function fromRecord(base: PayOutcome, rec: PaymentAccount): PayOutcome {
  if (rec.status === 'Paid') return { ...base, status: 'paid', amount: rec.amount };
  if (rec.status === 'Pending') {
    return { ...base, status: 'pending', amount: rec.amount, reasons: decodeReasons(rec.reasons), deadline: rec.deadline };
  }
  return { ...base, status: 'pending', error: clientError(`payment record is ${rec.status}`) };
}

/**
 * Pays a registered service under the agent's policy and reports what the chain decided.
 *
 * Inputs are checked and every read happens before anything is signed, so a failure there is
 * `failed` with nothing sent. After the send, only a confirmed result is final: a mined error is
 * `refused` (the program said no) or `failed` (the runtime did), and silence is `pending` with
 * `unconfirmed`, because the transaction may still land. Confirmation is retried, the send never.
 *
 * An id with no Service account is still sent, with preflight skipped and a stand-in payee, so the
 * refusal is mined and has a signature anyone can look up.
 */
export async function payService(p: PayParams): Promise<PayOutcome> {
  const { chain, team } = p;
  const intent = p.intent ?? makeIntent();
  const memo = clampMemo(p.memo);
  const base: PayOutcome = { status: 'failed', serviceId: p.serviceId, amount: p.amount, intent };
  const fail = (message: string): PayOutcome => ({ ...base, status: 'failed', error: clientError(message) });

  if (!isValidIntent(intent)) return fail(`bad intent: ${intent}`);
  if (p.amount <= 0n) return fail('amount must be above zero');

  // Reads. Any failure here stops before signing.
  let teamAcc, config, service;
  const svc = chain.servicePda(p.serviceId);
  try {
    [teamAcc, config] = await Promise.all([chain.team(team), chain.config()]);
    service = svc.placeholder ? null : await chain.service(p.serviceId);
  } catch (e) {
    return fail(`could not read the chain, nothing was sent: ${(e as Error).message}`);
  }
  if (!teamAcc) return fail(`no Rein team at ${team.toBase58()}`);
  if (!config) return fail('the Rein config account is missing');
  const vault = ReinChain.vaultAddress(team, config.mint);
  if (!vault.equals(teamAcc.vault)) return fail('the team vault is not the ATA for the config mint');

  const spender = chain.spenderPda(team, p.agent.publicKey);
  const payment = chain.paymentPda(spender, intent);
  const unknownService = service === null;
  // A registered service names its payee. An unknown one has none, so any stand-in will do:
  // the program stops at the missing Service account before it looks at the payee.
  const payeeToken = service ? service.payeeToken : Keypair.generate().publicKey;

  const ix = buildPayIx({
    programId: chain.programId,
    payer: p.sponsor.publicKey,
    authority: p.agent.publicKey,
    team,
    spender,
    service: svc.address,
    vault,
    payeeToken,
    payment,
    intent,
    amount: p.amount,
    memo,
  });

  let blockhash: string, lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await chain.connection.getLatestBlockhash('confirmed'));
  } catch (e) {
    return fail(`could not fetch a blockhash, nothing was sent: ${(e as Error).message}`);
  }
  const tx = new Transaction({ feePayer: p.sponsor.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  tx.sign(p.sponsor, p.agent);
  const signature = utils.bytes.bs58.encode(tx.signature!);
  const sent: PayOutcome = { ...base, payment, signature, unknownService };

  // Send once.
  try {
    await chain.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: unknownService,
      preflightCommitment: 'confirmed',
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/already been processed/i.test(msg)) {
      // It landed; fall through to confirmation.
    } else if (e instanceof SendTransactionError) {
      // The RPC rejected it in preflight, so it was never forwarded.
      const err = decodeTxError(e, e.transactionError.logs ?? null);
      const { signature: _s, ...notSent } = sent;
      return { ...notSent, status: isProgramRefusal(err) ? 'refused' : 'failed', error: err };
    } else {
      // A network error: the transaction may or may not be out. Check, don't resend.
      return confirmAndDecode(chain, sent, lastValidBlockHeight, p, msg);
    }
  }
  return confirmAndDecode(chain, sent, lastValidBlockHeight, p);
}

async function confirmAndDecode(
  chain: ReinChain,
  sent: PayOutcome,
  lastValidBlockHeight: number,
  p: PayParams,
  sendError?: string,
): Promise<PayOutcome> {
  const signature = sent.signature!;
  const payment = sent.payment!;
  const timeoutMs = p.confirmTimeoutMs ?? 60_000;
  const pollMs = p.pollMs ?? 500;
  const started = Date.now();
  let txErr: TransactionError | null | undefined;
  let landed = false;
  let expired = false;

  for (let i = 0; Date.now() - started < timeoutMs; i++) {
    try {
      const { value } = await chain.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const st = value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        landed = true;
        txErr = st.err;
        break;
      }
      if (i % 4 === 3) {
        const height = await chain.connection.getBlockHeight('confirmed');
        if (height > lastValidBlockHeight) {
          expired = true;
          break;
        }
      }
    } catch {
      // A failed status check is not an answer. Ask again.
    }
    await sleep(pollMs);
  }

  if (landed && txErr) {
    const logs = await transactionLogs(chain, signature);
    const err = decodeTxError(txErr, logs);
    return { ...sent, status: isProgramRefusal(err) ? 'refused' : 'failed', error: err };
  }

  // Landed cleanly, or we don't know. Either way the payment record is the truth if it exists.
  for (let attempt = 0; attempt < (landed ? 6 : 2); attempt++) {
    try {
      const rec = await chain.payment(payment);
      if (rec) return fromRecord(sent, rec);
    } catch {
      // keep trying
    }
    await sleep(pollMs);
  }

  const why = landed
    ? 'the transaction confirmed but the payment record could not be read'
    : expired
      ? 'no confirmation before the blockhash expired'
      : 'no confirmation yet';
  return {
    ...sent,
    status: 'pending',
    unconfirmed: true,
    error: clientError(
      `${why}${sendError ? ` (send error: ${sendError})` : ''}; check signature ${signature} before trying again`,
    ),
  };
}

async function transactionLogs(chain: ReinChain, signature: string): Promise<string[] | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const tx = await chain.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta?.logMessages) return tx.meta.logMessages;
    } catch {
      // retry
    }
    await sleep(400);
  }
  return null;
}

export function outcomeSummary(o: PayOutcome): string {
  return o.error ? describeError(o.error) : o.status;
}
