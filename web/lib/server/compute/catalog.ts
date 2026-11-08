// Per-model prices for the compute gateway, in micro-USD per million tokens (so $1.00/MTok is
// 1_000_000n). Money stays integer: a quote is computed from these with bigint math only.
//
// Sources:
//   claude-haiku-5-5  $0.10 in / $0.50 out per MTok, prompts up to 100K tokens. Anthropic's model
//                     table as bundled with the Claude API skill (cached 2026-10-06), which cites
//                     https://platform.claude.com/docs/en/about-claude/pricing. Prompts here are
//                     capped at 4,000 characters, far under the 100K tier.
//   claude-haiku-4-5  $1.00 / $5.00 per MTok, same source.
//   claude-sonnet-5-5 $2.00 / $10.00 per MTok, same source.
//
// OpenAI (codex-run): no model is listed because the model is not chosen yet (CODEX_MODEL has no
// default) and no price was verified. Until one is added here, set COMPUTE_PRICE_CODEX_RUN to
// "<input USD per MTok>/<output USD per MTok>" from OpenAI's pricing page, or codex-run answers
// 503 "not configured". An unknown model is never priced at a guess.

export type ModelPrice = {
  /** micro-USD per million input tokens */
  inMicroPerMTok: bigint;
  /** micro-USD per million output tokens */
  outMicroPerMTok: bigint;
  source: string;
  /** Extra request fields this model needs (Anthropic only). */
  anthropicExtras?: Record<string, unknown>;
};

const ANTHROPIC_PRICING = 'Anthropic pricing (platform.claude.com/docs/en/about-claude/pricing), as of 2026-10-06';

export const CATALOG: Record<string, ModelPrice> = {
  // Thinking is on by default on Haiku 5.5 and counts against max_tokens; low effort keeps a short
  // request's answer inside the 1,024-token cap.
  'claude-haiku-5-5': { inMicroPerMTok: 100_000n, outMicroPerMTok: 500_000n, source: ANTHROPIC_PRICING, anthropicExtras: { output_config: { effort: 'low' } } },
  'claude-haiku-4-5': { inMicroPerMTok: 1_000_000n, outMicroPerMTok: 5_000_000n, source: ANTHROPIC_PRICING },
  'claude-sonnet-5-5': { inMicroPerMTok: 2_000_000n, outMicroPerMTok: 10_000_000n, source: ANTHROPIC_PRICING, anthropicExtras: { output_config: { effort: 'low' } } },
};

/** "0.10/0.50" (USD per MTok, at most 6 decimals) to micro-USD per MTok, or null when malformed. */
export function parsePriceOverride(raw: string | undefined): ModelPrice | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,6}(?:\.\d{1,6})?)\s*\/\s*(\d{1,6}(?:\.\d{1,6})?)\s*$/.exec(raw);
  if (!m) return null;
  const micro = (s: string) => {
    const [w, f = ''] = s.split('.');
    return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, '0'));
  };
  const inP = micro(m[1]);
  const outP = micro(m[2]);
  if (inP <= 0n || outP <= 0n) return null;
  return { inMicroPerMTok: inP, outMicroPerMTok: outP, source: 'operator-set env price' };
}
