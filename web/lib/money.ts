// Money input. Amounts stay in integer base units; these parse strictly and fail closed.

export const USDC_UNIT = 1_000_000n;

/** "1.5" → 1500000n. Anything malformed, negative or with more than 6 decimals → null. */
export function parseUsdc(input: string): bigint | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^\$/, '');
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * USDC_UNIT + BigInt(frac.padEnd(6, '0'));
}

/** A whole number in [min, max], or null. */
export function parseCount(input: string, min: number, max: number): number | null {
  if (!/^\d{1,10}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= min && n <= max ? n : null;
}

/** Exact decimal string with all six places, for CSV. */
export function decimal(units: bigint): string {
  return `${units / USDC_UNIT}.${(units % USDC_UNIT).toString().padStart(6, '0')}`;
}

export const PERIODS: { label: string; secs: number }[] = [
  { label: 'a minute', secs: 60 },
  { label: 'an hour', secs: 3600 },
  { label: 'a day', secs: 86400 },
  { label: 'a week', secs: 604800 },
  { label: 'a month (30 days)', secs: 2592000 },
];
