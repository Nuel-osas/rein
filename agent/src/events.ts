/** What `runAgent` yields. The web UI renders these in order. */

export type PaymentEventStatus = 'paid' | 'pending' | 'refused' | 'failed';

export type AgentEvent =
  | { type: 'thinking'; text: string; probe?: boolean }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; probe?: boolean }
  | { type: 'tool_result'; name: string; result: unknown; probe?: boolean }
  | PaymentEvent
  | { type: 'final'; text: string; error?: string };

export interface PaymentEvent {
  type: 'payment';
  status: PaymentEventStatus;
  /** The service id the model asked for, registered or not. */
  service: string;
  /** Base units (6 decimals). Null when the model's amount could not be parsed. */
  amount: bigint | null;
  /** Pending only: why the program filed it for the owner. */
  reasons?: string[];
  signature?: string;
  /** The payment record's address. */
  payment?: string;
  /** A readable error, e.g. "AccountNotInitialized (3012) on account service: ...". */
  error?: string;
  errorName?: string;
  errorCode?: number;
  intent?: string;
  /** Pending because no confirmation came back, not because the owner must approve. Don't retry. */
  unconfirmed?: boolean;
  /** Pending only: unix time until which the owner can approve. */
  deadline?: number;
  /** Emitted by the red-team check, not by the model. */
  probe?: boolean;
}

/** JSON.stringify replacer that writes bigints as decimal strings, for streaming events. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** An event as JSON, with base-unit amounts as strings. */
export function eventToJSON(e: AgentEvent): string {
  return JSON.stringify(e, bigintReplacer);
}
