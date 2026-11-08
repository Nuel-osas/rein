import {USDC_DECIMALS, usdc} from "@/lib/chain";

/* ===========================================================================
   How /stats words and formats what it read. Money arrives as a decimal string
   of USDC base units (a bigint on the server) and is only formatted here, for
   display. An unknown figure is UNKNOWN_MARK plus a sentence saying why.
   =========================================================================== */

export const UNKNOWN_MARK = "—";

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** USDC base units, given as a decimal string, as dollars with cents. Display only. */
export function formatUsdc(baseUnits: string): string {
  return usdc(BigInt(baseUnits));
}

/**
 * Base units as whole cents, for the count-up animation only. Null when the amount has a fraction
 * of a cent or is too large to animate exactly: the figure is then shown as it is, without counting.
 */
export function baseUnitsToCents(baseUnits: string): number | null {
  const units = BigInt(baseUnits);
  const perCent = 10n ** BigInt(USDC_DECIMALS - 2);
  if (units % perCent !== 0n) return null;
  const cents = units / perCent;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Whole cents as "$1,234.50", for the frames of the count-up animation. */
export function centsToDollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${rest}`;
}

/** "Updated 12 seconds ago". */
export function ageText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

/** "2 hours ago", "3 days ago" for a payment, from its on-chain unix time. */
export function sinceText(seconds: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000 - seconds));
  if (diff < 60) return "under a minute ago";
  const m = Math.floor(diff / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
