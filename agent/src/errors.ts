import { LangErrorCode, LangErrorMessage } from '@coral-xyz/anchor';
import { IDL_ERRORS } from './idl.ts';

/** A failure, decoded to a name a person can read. */
export interface DecodedError {
  /** Custom error number, when there is one. */
  code: number | null;
  name: string;
  message: string;
  /** The account Anchor blamed, when the logs say. */
  account?: string;
  /** program = Rein's own errors (6000+), anchor = framework checks, runtime = Solana itself. */
  source: 'program' | 'anchor' | 'runtime' | 'client';
}

const ANCHOR_NAMES = new Map<number, string>(
  Object.entries(LangErrorCode as Record<string, number>).map(([name, code]) => [code, name]),
);
const PROGRAM_ERRORS = new Map(IDL_ERRORS.map((e) => [e.code, e]));

/** Maps an error number to its name: Rein's errors from the IDL, framework errors from Anchor. */
export function errorFromCode(code: number): DecodedError {
  const own = PROGRAM_ERRORS.get(code);
  if (own) return { code, name: own.name, message: own.msg ?? own.name, source: 'program' };
  const anchorName = ANCHOR_NAMES.get(code);
  if (anchorName) {
    return { code, name: anchorName, message: LangErrorMessage.get(code) ?? anchorName, source: 'anchor' };
  }
  return { code, name: `Custom${code}`, message: `custom program error ${code}`, source: 'runtime' };
}

/** True when the program itself (Rein or its Anchor checks) said no, as opposed to the runtime. */
export function isProgramRefusal(e: DecodedError): boolean {
  return e.source === 'program' || e.source === 'anchor';
}

const ANCHOR_LOG =
  /AnchorError (?:caused by account: (\w+)|thrown in \S+?|occurred)\. Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;

/** Reads the AnchorError line a failed instruction leaves in the logs. */
export function errorFromLogs(logs: readonly string[] | null | undefined): DecodedError | null {
  if (!logs) return null;
  for (const line of logs) {
    const m = ANCHOR_LOG.exec(line);
    if (m) {
      const decoded = errorFromCode(Number(m[3]));
      return { ...decoded, account: m[1] ?? undefined, name: m[2] ?? decoded.name };
    }
  }
  for (const line of logs) {
    const m = /custom program error: (0x[0-9a-fA-F]+)/.exec(line);
    if (m) return errorFromCode(parseInt(m[1]!, 16));
  }
  return null;
}

/**
 * Decodes a transaction error (the `err` of a signature status, or a thrown send error),
 * preferring the logs because they name the account.
 */
export function decodeTxError(err: unknown, logs?: readonly string[] | null): DecodedError {
  const fromLogs = errorFromLogs(logs);
  if (fromLogs) return fromLogs;

  if (err && typeof err === 'object' && 'InstructionError' in err) {
    const [, inner] = (err as { InstructionError: [number, unknown] }).InstructionError;
    if (inner && typeof inner === 'object' && 'Custom' in inner) {
      return errorFromCode(Number((inner as { Custom: number }).Custom));
    }
    const name = typeof inner === 'string' ? inner : JSON.stringify(inner);
    return { code: null, name, message: `instruction failed: ${name}`, source: 'runtime' };
  }
  if (typeof err === 'string') return { code: null, name: err, message: err, source: 'runtime' };
  if (err instanceof Error) {
    const m = /custom program error: (0x[0-9a-fA-F]+)/.exec(err.message);
    if (m) return errorFromCode(parseInt(m[1]!, 16));
    return { code: null, name: err.name || 'Error', message: err.message, source: 'runtime' };
  }
  if (err && typeof err === 'object') {
    const name = Object.keys(err)[0] ?? 'UnknownError';
    return { code: null, name, message: JSON.stringify(err), source: 'runtime' };
  }
  return { code: null, name: 'UnknownError', message: String(err), source: 'runtime' };
}

export function describeError(e: DecodedError): string {
  const code = e.code === null ? '' : ` (${e.code})`;
  const where = e.account ? ` on account ${e.account}` : '';
  return `${e.name}${code}${where}: ${e.message}`;
}
