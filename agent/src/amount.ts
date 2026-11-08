/**
 * USDC amounts. Money is a bigint of base units (6 decimals) everywhere in this package;
 * it becomes a decimal string only for display or for the model to read.
 */

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;
export const U64_MAX = (1n << 64n) - 1n;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

const DECIMAL = /^(\d{1,20})(?:\.(\d{1,6}))?$/;

/**
 * Parses a decimal USDC string ("0.40", "12", "1.5") into base units.
 * Rejects more than 6 decimals, signs, exponents, zero, values above u64 and anything else.
 * A finite JS number is accepted only through its decimal string form, so 1e-7 is refused.
 */
export function parseUsdc(input: unknown): bigint {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new AmountError('amount_usdc must be a decimal string like "0.40"');
  }
  const text = String(input).trim();
  const m = DECIMAL.exec(text);
  if (!m) {
    if (/^\d+\.\d{7,}$/.test(text)) {
      throw new AmountError(`amount_usdc has more than ${USDC_DECIMALS} decimals: ${JSON.stringify(text)}`);
    }
    throw new AmountError(`amount_usdc is not a positive decimal USDC amount: ${JSON.stringify(text)}`);
  }
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(USDC_DECIMALS, '0'));
  const base = whole * USDC_UNIT + frac;
  if (base === 0n) throw new AmountError('amount_usdc must be above zero');
  if (base > U64_MAX) throw new AmountError('amount_usdc is larger than the chain can hold');
  return base;
}

/** Base units to a display string with 2 to 6 decimals: 400000n -> "0.40", 1234567n -> "1.234567". */
export function formatUsdc(base: bigint): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const whole = abs / USDC_UNIT;
  let frac = (abs % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Like formatUsdc, but an unknown amount stays unknown. */
export function formatUsdcOrNull(base: bigint | null): string | null {
  return base === null ? null : formatUsdc(base);
}
