import type {RunOutcome} from "./commerce/index";

/*
 * Every way a run can fail, with whether trying again may help and what a person is told.
 *
 * A provider's raw error never reaches `message`: it goes to the log through `detail` only. The
 * gateway shows `message` to the person who paid, and decides on `retryable` whether to run the
 * purchase again (which may cost the gateway compute again, never the buyer a second payment).
 */

export type FailureCode =
  | "aborted"
  | "timeout"
  | "input_invalid"
  | "no_provider"
  | "ledger_unreadable"
  | "ledger_cap"
  | "ledger_unfunded"
  | "funding_failed"
  | "unsettled_unreadable"
  | "acknowledge_failed"
  | "provider_balance"
  | "provider_busy"
  | "provider_rejected"
  | "provider_unavailable"
  | "empty_output"
  | "output_unreadable"
  | "download_failed"
  | "video_failed"
  | "video_refused"
  | "verification_rejected"
  | "verification_unavailable";

interface FailureSpec {
  retryable: boolean;
  message: string;
}

const NOTHING_SPENT = "Nothing was charged for it.";

export const FAILURES: Record<FailureCode, FailureSpec> = {
  aborted: {retryable: true, message: "The run was stopped before it finished."},
  timeout: {retryable: true, message: "The compute provider took too long to answer. Try again in a moment."},
  input_invalid: {retryable: false, message: "That input cannot be run as it is."},
  no_provider: {retryable: false, message: "No verified compute provider is serving this model right now."},
  ledger_unreadable: {retryable: true, message: `We could not read the compute balance, so the run did not start. ${NOTHING_SPENT}`},
  ledger_cap: {retryable: false, message: "The compute balance is at its limit and needs an operator to review it. The run did not start."},
  ledger_unfunded: {retryable: false, message: "The compute balance is too low for this run and needs an operator to top it up. The run did not start."},
  funding_failed: {retryable: true, message: "We could not set aside compute funds for this run, so it did not start. Try again in a moment."},
  unsettled_unreadable: {retryable: true, message: "We could not confirm the compute provider's open charges, so the run did not start. Try again in a moment."},
  acknowledge_failed: {retryable: true, message: "We could not register with the compute provider, so the run did not start. Try again in a moment."},
  provider_balance: {retryable: true, message: "The compute provider asked for more funds before it would run this. Try again in a moment."},
  provider_busy: {retryable: true, message: "The compute provider is busy. Try again in a moment."},
  provider_rejected: {retryable: false, message: "The compute provider refused this request."},
  provider_unavailable: {retryable: true, message: "The compute provider could not be reached. Try again in a moment."},
  empty_output: {retryable: true, message: "The compute provider returned an empty result."},
  output_unreadable: {retryable: true, message: "The compute provider returned a result we could not read."},
  download_failed: {retryable: true, message: "The result was made but we could not download it."},
  video_failed: {retryable: true, message: "The video could not be made."},
  video_refused: {retryable: false, message: "The video provider refused this prompt."},
  verification_rejected: {retryable: false, message: "The result's signature did not match the provider's enclave, so it was not delivered."},
  verification_unavailable: {retryable: true, message: "We could not check the result's signature, so it was withheld rather than delivered unchecked."},
};

export type Failure = Extract<RunOutcome, {ok: false}> & {code: FailureCode; detail?: string};

/** A failure with the standard message; `message` overrides it only with a person's words. */
export function fail(code: FailureCode, detail?: string, message?: string): Failure {
  const spec = FAILURES[code];
  return {ok: false, code, retryable: spec.retryable, message: message ?? spec.message, ...(detail ? {detail: redact(detail)} : {})};
}

/** Thrown inside the adapter and turned into a `Failure` at the edge of `run`. */
export class ZgFailure extends Error {
  readonly failure: Failure;
  constructor(code: FailureCode, detail?: string, message?: string) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "ZgFailure";
    this.failure = fail(code, detail, message);
  }
}

/** A short, single-line description of anything thrown, for `detail` and logs. */
export function describe(err: unknown): string {
  if (err instanceof Error) return redact(err.message.replace(/\s+/g, " ")).slice(0, 300);
  return redact(String(err).replace(/\s+/g, " ")).slice(0, 300);
}

/**
 * Removes bearer credentials from text bound for logs. The adapter never writes its Authorization
 * header anywhere, but a provider can echo it back in an error body or header, and the session
 * token in it spends this wallet's locked balance with that provider until it expires.
 */
export function redact(text: string): string {
  return text.replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]").replace(/\bapp-sk-[^\s"',;]+/g, "app-sk-[redacted]");
}

/** An event with every string in it redacted (to a few levels deep), for `onEvent`. */
export function redactDeep<T>(value: T, depth = 4): T {
  if (typeof value === "string") return redact(value) as T;
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth - 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, depth - 1);
  return out as T;
}
