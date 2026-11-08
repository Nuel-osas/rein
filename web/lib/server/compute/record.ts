// The durable record of each compute run in Postgres (compute_runs, migrated on first use).
// Redis holds the locks, counters and TTL'd results; this row is what survives them.

import { ensureComputeRuns, type Sql } from '../store';

export type RunRow = { intent: string; team: string; spender: string; service: string; amount: bigint; status: string; resultHash?: string | null; refundSig?: string | null };

export async function recordRun(sql: Sql, r: RunRow): Promise<void> {
  await ensureComputeRuns(sql);
  await sql`
    INSERT INTO compute_runs (intent, team, spender, service, amount, status, result_hash, refund_sig)
    VALUES (${r.intent}, ${r.team}, ${r.spender}, ${r.service}, ${r.amount.toString()}, ${r.status}, ${r.resultHash ?? null}, ${r.refundSig ?? null})
    ON CONFLICT (intent) DO UPDATE SET
      status = EXCLUDED.status,
      result_hash = COALESCE(EXCLUDED.result_hash, compute_runs.result_hash),
      refund_sig = COALESCE(EXCLUDED.refund_sig, compute_runs.refund_sig),
      updated_at = now()`;
}
