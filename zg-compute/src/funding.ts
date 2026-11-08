import type {ZgLedger, ZgLedgerLimits, ZgSubAccount} from "./port";
import {ceilToWholeZg, formatZg, maxBig, NEURON_PER_ZG} from "./units";

/*
 * How much 0G a run needs where, decided before anything is sent.
 *
 * A provider serves a request only while the wallet's locked balance with it covers
 *   its fixed minimum (1 0G) + fees it has not settled yet + this request's fee
 * (0g-serving-broker, ctrl.validateBalanceAdequacy). It settles in delayed batches out of that
 * locked balance, so usage drains it and it is re-read on every run, never remembered.
 *
 * Video is stricter than the provider is: Seedance bills on a token count the vendor reports after
 * the clip is made, so the provider forwards a video create gated only by the minimum and settles
 * the fee later. If the locked balance cannot cover that fee the settlement is partial and the
 * provider stops serving the wallet. So the run's own worst case is always in `required`, and an
 * unsettled total that cannot be read stops a video run rather than being guessed.
 *
 * The plan never lets the ledger's total balance (available plus everything locked with providers)
 * pass `maxLedger`, and never spends the wallet's gas reserve.
 */

export interface FundingConfig {
  /** Ceiling on the ledger's total balance after any deposit, neuron. */
  maxLedger: bigint;
  /** The provider's fixed minimum locked balance, neuron (1 0G on mainnet). */
  providerMinimum: bigint;
  /** Headroom over the requirement, basis points of the provider minimum (500 = 5%). */
  marginBps: bigint;
  /** 0G kept in the wallet for gas, never deposited, neuron. */
  gasReserve: bigint;
  /** The SDK refuses to open a ledger below this many whole 0G, whatever the contract allows. */
  sdkLedgerFloorZg: bigint;
}

export const DEFAULT_FUNDING: FundingConfig = {
  maxLedger: 10n * NEURON_PER_ZG,
  providerMinimum: NEURON_PER_ZG,
  marginBps: 500n,
  gasReserve: NEURON_PER_ZG / 10n,
  sdkLedgerFloorZg: 3n,
};

export interface FundingInput {
  sub: ZgSubAccount | null;
  ledger: ZgLedger | null;
  limits: ZgLedgerLimits;
  /** The provider's unsettled fees for this wallet, neuron. */
  unsettled: bigint;
  /** This run's worst-case fee, neuron. */
  cost: bigint;
  /** The wallet's own 0G; null when it has not been read (only needed when a deposit is). */
  wallet: bigint | null;
}

export interface FundingPlan {
  /** Locked with the provider now, neuron. */
  locked: bigint;
  /** What must be locked before the request, neuron. */
  required: bigint;
  /** Whole 0G to open the ledger with, or 0n. */
  createLedgerZg: bigint;
  /** Whole 0G to add to an existing ledger, or 0n. */
  depositZg: bigint;
  /** Neuron to move from the ledger to the provider, or 0n. */
  transfer: bigint;
  /** Whether this wallet still has to acknowledge the provider's signer. */
  acknowledge: boolean;
}

export type FundingDecision =
  | {ok: true; plan: FundingPlan}
  | {ok: false; code: "ledger_cap" | "ledger_unfunded" | "wallet_unread"; detail: string};

export function requiredLocked(cfg: FundingConfig, unsettled: bigint, cost: bigint): bigint {
  return cfg.providerMinimum + unsettled + cost + (cfg.providerMinimum * cfg.marginBps) / 10_000n;
}

export function planFunding(cfg: FundingConfig, x: FundingInput): FundingDecision {
  const locked = x.sub ? maxBig(x.sub.balance - x.sub.pendingRefund, 0n) : 0n;
  const required = requiredLocked(cfg, x.unsettled, x.cost);
  const acknowledge = !x.sub?.acknowledged;
  const base = {locked, required, acknowledge};
  if (locked >= required) return {ok: true, plan: {...base, createLedgerZg: 0n, depositZg: 0n, transfer: 0n}};

  // Top up to the full requirement in one transfer, never below the contract's minimum transfer: a
  // shortfall-sized transfer can be smaller than that and be refused though the target is legal.
  const transfer = maxBig(required - locked, x.limits.minTransferAmount);
  const available = x.ledger?.availableBalance ?? 0n;
  const total = x.ledger?.totalBalance ?? 0n;

  let createLedgerZg = 0n;
  let depositZg = 0n;
  if (!x.ledger) {
    createLedgerZg = maxBig(ceilToWholeZg(transfer), ceilToWholeZg(x.limits.minAccountBalance), cfg.sdkLedgerFloorZg);
  } else if (available < transfer) {
    depositZg = maxBig(ceilToWholeZg(transfer - available), ceilToWholeZg(x.limits.minTransferAmount), 1n);
  }
  const adding = (createLedgerZg + depositZg) * NEURON_PER_ZG;
  if (adding > 0n) {
    if (total + adding > cfg.maxLedger) {
      return {ok: false, code: "ledger_cap", detail: `ledger total ${formatZg(total)} + deposit ${formatZg(adding)} would pass the cap ${formatZg(cfg.maxLedger)} 0G`};
    }
    if (x.wallet === null) return {ok: false, code: "wallet_unread", detail: "wallet balance needed for a deposit and not read"};
    if (x.wallet < adding + cfg.gasReserve) {
      return {ok: false, code: "ledger_unfunded", detail: `deposit ${formatZg(adding)} + gas reserve ${formatZg(cfg.gasReserve)} needs more than the wallet's ${formatZg(x.wallet)} 0G`};
    }
  }
  return {ok: true, plan: {...base, createLedgerZg, depositZg, transfer}};
}
