/* ===========================================================================
   Presentation helpers.

   Two rules live here rather than at every call site, because they are the two
   that cost money when they are forgotten:

     1. An unread value is an em dash. Never zero, never "$0.00".
     2. Rounding happens in integers. `Number(base) / 1e6` is fine for the
        amounts in a demo and wrong for the amounts in a ledger, so the money
        formatter never leaves `bigint` until the digits are final.

   Dates format in UTC on purpose. The server render and the client hydration
   have to produce identical strings or React throws a mismatch, and the
   fixture clock is pinned to UTC.
   =========================================================================== */

import type {Period, Unread, Usd} from "@/lib/fixtures";

/** The glyph for "we do not know". */
export const UNKNOWN = "—";

/** Read by screen readers in place of the dash, which announces as nothing useful. */
export const UNKNOWN_LABEL = "Not available";

const grouped = new Intl.NumberFormat("en-US");

/**
 * Rounds to cents in integer arithmetic, then groups.
 * `1_412_500_000n` becomes `1,412.50`, with no float anywhere in the path.
 */
function toParts(value: Usd): {sign: string; whole: string; cents: string} {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  // Round half up at the cent, carrying into dollars where it needs to.
  const cents = (abs + 5_000n) / 10_000n;
  const whole = cents / 100n;
  const remainder = cents % 100n;
  return {
    sign: negative ? "-" : "",
    whole: grouped.format(whole),
    cents: remainder.toString().padStart(2, "0"),
  };
}

/** `$1,412.50`, or an em dash when the value was never read. */
export function formatUsd(value: Unread<Usd>): string {
  if (value === null || value === undefined) return UNKNOWN;
  const {sign, whole, cents} = toParts(value);
  return `${sign}$${whole}.${cents}`;
}

/** Dollars and cents apart, so the hero can set the cents smaller. */
export function splitUsd(value: Unread<Usd>): {dollars: string; cents: string} | null {
  if (value === null || value === undefined) return null;
  const {sign, whole, cents} = toParts(value);
  return {dollars: `${sign}$${whole}`, cents};
}

/** A count that may not have loaded. */
export function formatCount(value: Unread<number>): string {
  if (value === null || value === undefined) return UNKNOWN;
  return grouped.format(value);
}

/**
 * Share of an allowance used, `null` when unknown.
 * Clamped, because a period that overspent by a rounding unit should still
 * draw a full bar rather than overflow its track.
 */
export function usedFraction(spent: Unread<Usd>, allowance: Usd): number | null {
  if (spent === null || allowance <= 0n) return null;
  const pct = Number((spent * 10_000n) / allowance) / 10_000;
  return Math.min(1, Math.max(0, pct));
}

/* --- Time ----------------------------------------------------------------- */

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** `11 Sep 2026, 16:40`. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** `11 Sep 2026`. */
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/**
 * Real wall-clock time.
 *
 * ================== THE TRAP THIS CLOSED ==================
 * These three used to default `now` to the fixture constant `NOW`, frozen at
 * 2026-09-11 so fixture screens rendered identically every run. That default
 * was correct for fixture data and SILENTLY WRONG for live data: a real chain
 * timestamp is later than the frozen NOW, the subtraction goes negative,
 * `Math.max(0, …)` clamps it, and every live timestamp on the screen reads
 * "just now". It said that about an hour-old request, which is the only reason
 * it was ever noticed.
 *
 * The note here used to say the default should flip "when the last fixture
 * screen is gone". Every screen reads the chain now, so it has flipped.
 * Determinism moved to the callers that want it — the harnesses and tests pass
 * `NOW` explicitly, which is the right way round: a frozen clock is a testing
 * affordance, not a default the product should inherit.
 * ==========================================================
 */
export const nowIso = () => new Date().toISOString();

/**
 * `18 minutes ago`, `3 hours ago`, `4 days ago`. Never bare numbers.
 *
 * @param now Defaults to real time. Pass a fixed ISO string for deterministic
 *            rendering in a test or a harness.
 */
export function formatAgo(iso: string, now: string = nowIso()): string {
  const seconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${plural(days, "day")} ago`;
  return formatDate(iso);
}

/** `in 3 days`, `in 6 hours`. For resets and expiries. */
export function formatUntil(iso: string, now: string = nowIso()): string {
  const seconds = Math.round((Date.parse(iso) - Date.parse(now)) / 1000);
  if (seconds <= 0) return "now";
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `in ${Math.max(1, hours)} ${plural(Math.max(1, hours), "hour")}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${plural(days, "day")}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/**
 * The quotable identifier for a receipt: `RCPT-64554092-4A9C2F`.
 *
 * Derived rather than stored, from the block and the first bytes of the
 * transaction hash, so it cannot drift from the thing it names and needs no
 * column anywhere. It exists because nobody reads a 66-character hash down a
 * phone, and a receipt with no reference is a receipt you cannot talk about.
 *
 * The full hash still renders on the document. This is the short handle, not
 * a replacement for the proof.
 */
export function receiptReference(hash: string | null, block: string | number | null): string {
  if (!hash || block === null || block === undefined) return UNKNOWN;
  const tail = hash.replace(/^0x/, "").slice(0, 6).toUpperCase();
  if (tail.length < 6) return UNKNOWN;
  return `RCPT-${block}-${tail}`;
}

/* --- Words ---------------------------------------------------------------- */

/** `this week`. Reads naturally after "left". */
export function periodWindow(period: Period): string {
  return period === "daily" ? "today" : period === "weekly" ? "this week" : "this month";
}

/** `a week`. Reads naturally after "every". */
export function periodSpan(period: Period): string {
  return period === "daily" ? "a day" : period === "weekly" ? "a week" : "a month";
}

/** `Weekly`. */
export function periodName(period: Period): string {
  return period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : "Monthly";
}
