/* ===========================================================================
   The words.

   Kept in one file so the same event never gets two different names on two
   different screens. Plain words, second person, a verb at the front of every
   action, and no em dashes in anything a person reads.
   =========================================================================== */

import type {BlockReason, SpenderStatus} from "@/lib/fixtures";

/**
 * Tone drives colour, and colour is never the only signal: every tone is
 * paired with a label and an icon at the call site.
 *
 * `blocked` is amber, not red. A refusal is the account doing its job, so it
 * must read as protection. Red is kept for `failed`, which means a payment the
 * account meant to make did not happen.
 */
export type Tone = "settled" | "blocked" | "pending" | "failed" | "neutral";

export const BLOCK_REASON: Record<BlockReason, {title: string; detail: string}> = {
  "over-allowance": {title: "Over the allowance left", detail: "The payment was larger than what is left this period, so the program filed it for the owner instead of paying."},
  "over-payment-cap": {title: "Over the per-payment cap", detail: "The policy caps one payment, and this was larger, so it waits for the owner."},
  "merchant-not-approved": {title: "Service not on its list", detail: "This service is registered but not on the spender's list, so the program held the payment."},
  "over-frequency": {title: "No payments left this period", detail: "The policy allows a set number of payments each period and all of them are used."},
  "policy-expired": {title: "Policy has expired", detail: "The policy ended, so nothing can be paid under it until the owner sets a new one."},
  "spender-paused": {title: "Spender is paused", detail: "The owner paused this spender, so its payments stop before they leave the vault."},
};

export const SPENDER_KIND_LABEL = {
  person: "Person",
  agent: "AI agent",
} as const;

export const SPENDER_STATUS_COPY: Record<SpenderStatus, {tone: Tone; label: string}> = {
  active: {tone: "settled", label: "Active"},
  paused: {tone: "pending", label: "Paused"},
  // Revoking is the owner acting on purpose. Red would mean "something
  // went wrong", which turns a deliberate decision into an alarm.
  revoked: {tone: "neutral", label: "Revoked"},
  expired: {tone: "blocked", label: "Expired"},
};
