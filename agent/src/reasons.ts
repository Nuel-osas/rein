/** Why a payment went to the owner: the bits of `Payment::reasons` in programs/rein/src/lib.rs. */
export const REASON_BITS = {
  service_not_allowed: 1, // OVER_SERVICE
  over_cap: 2, // OVER_CAP
  over_allowance: 4, // OVER_ALLOWANCE
  over_payment_count: 8, // OVER_COUNT
} as const;

export type Reason = keyof typeof REASON_BITS;

/**
 * Decodes the reasons bitmask. Bits the contract does not define are kept as `unknown_bit_<n>`
 * rather than dropped, so a newer program never looks like a clean payment.
 */
export function decodeReasons(bits: number): string[] {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xff) {
    throw new RangeError(`reasons must be a u8, got ${bits}`);
  }
  const out: string[] = [];
  for (const [name, bit] of Object.entries(REASON_BITS)) {
    if (bits & bit) out.push(name);
  }
  const known = Object.values(REASON_BITS).reduce((a, b) => a | b, 0);
  for (let bit = 1; bit <= 0x80; bit <<= 1) {
    if (bits & bit & ~known) out.push(`unknown_bit_${bit}`);
  }
  return out;
}

const PLAIN: Record<string, string> = {
  service_not_allowed: 'the service is not on this spender\'s allowed list',
  over_cap: 'the amount is above the per-payment cap',
  over_allowance: 'it would go past the allowance for this period',
  over_payment_count: 'the spender has used all its payments for this period',
};

export function explainReason(reason: string): string {
  return PLAIN[reason] ?? reason;
}
