import {describe, expect, it} from "vitest";
import {DEFAULT_FUNDING, planFunding, requiredLocked, type FundingInput} from "./funding";
import {ZG} from "./test-helpers";

const limits = {minAccountBalance: 3n * ZG, minTransferAmount: ZG};
const base: FundingInput = {sub: null, ledger: null, limits, unsettled: 0n, cost: 0n, wallet: 20n * ZG};
const cfg = DEFAULT_FUNDING;
const CHAT = 5_826_560_000_000_000n;

describe("requiredLocked", () => {
  it("is the provider minimum, unsettled fees, this run's cost and a 5% margin of the minimum", () => {
    expect(requiredLocked(cfg, 2n, 3n)).toBe(ZG + 2n + 3n + ZG / 20n);
  });
});

describe("planFunding", () => {
  it("opens a ledger at the SDK's 3 0G floor and moves the full requirement to the provider", () => {
    const d = planFunding(cfg, {...base, cost: CHAT});
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.plan.createLedgerZg).toBe(3n);
    expect(d.plan.depositZg).toBe(0n);
    expect(d.plan.transfer).toBe(ZG + CHAT + ZG / 20n); // 1.05582656 0G, as the live chat run moved
    expect(d.plan.acknowledge).toBe(true);
  });

  it("does nothing when the locked balance already covers the run", () => {
    const sub = {balance: 2n * ZG, pendingRefund: 0n, acknowledged: true};
    const d = planFunding(cfg, {...base, sub, ledger: {availableBalance: 0n, totalBalance: 2n * ZG}, cost: CHAT});
    expect(d).toEqual({ok: true, plan: expect.objectContaining({createLedgerZg: 0n, depositZg: 0n, transfer: 0n, acknowledge: false})});
  });

  it("re-reads usage: a drained sub-account is topped up to the full requirement", () => {
    const sub = {balance: ZG + ZG / 100n, pendingRefund: 0n, acknowledged: true};
    const d = planFunding(cfg, {...base, sub, ledger: {availableBalance: 5n * ZG, totalBalance: 6n * ZG}, unsettled: ZG / 50n, cost: CHAT});
    if (!d.ok) throw new Error("expected a plan");
    // the shortfall is about 0.06 0G, but a transfer is never below the contract's 1 0G minimum
    expect(d.plan.transfer).toBe(ZG);
  });

  it("counts a pending refund as not locked", () => {
    const sub = {balance: 2n * ZG, pendingRefund: 2n * ZG, acknowledged: true};
    const d = planFunding(cfg, {...base, sub, ledger: {availableBalance: 3n * ZG, totalBalance: 5n * ZG}, cost: CHAT});
    if (!d.ok) throw new Error("expected a plan");
    expect(d.plan.locked).toBe(0n);
    expect(d.plan.transfer).toBe(ZG + CHAT + ZG / 20n);
  });

  it("deposits whole 0G when the ledger's available balance is short", () => {
    const d = planFunding(cfg, {...base, ledger: {availableBalance: 776_215_500_000_000_000n, totalBalance: 4n * ZG}, cost: 1_525_683_600_000_000_000n});
    if (!d.ok) throw new Error("expected a plan");
    expect(d.plan.depositZg).toBe(2n); // what the live video run deposited
  });

  it("never lets the ledger's total pass the cap", () => {
    const d = planFunding({...cfg, maxLedger: 7n * ZG}, {...base, ledger: {availableBalance: 0n, totalBalance: 6n * ZG + ZG / 2n}, cost: CHAT});
    expect(d).toEqual({ok: false, code: "ledger_cap", detail: expect.stringContaining("cap 7.000000")});
  });

  it("refuses to open a ledger past the cap too", () => {
    const d = planFunding({...cfg, maxLedger: 2n * ZG}, {...base, cost: CHAT});
    expect(d.ok && "plan").toBe(false);
    if (!d.ok) expect(d.code).toBe("ledger_cap");
  });

  it("keeps the gas reserve in the wallet", () => {
    const d = planFunding(cfg, {...base, wallet: 3n * ZG, cost: CHAT});
    expect(d).toEqual({ok: false, code: "ledger_unfunded", detail: expect.stringContaining("gas reserve")});
    expect(planFunding(cfg, {...base, wallet: 3n * ZG + ZG / 10n, cost: CHAT}).ok).toBe(true);
  });

  it("asks for the wallet balance only when a deposit is needed", () => {
    const ledger = {availableBalance: 5n * ZG, totalBalance: 5n * ZG};
    expect(planFunding(cfg, {...base, ledger, wallet: null, cost: CHAT}).ok).toBe(true);
    expect(planFunding(cfg, {...base, ledger: null, wallet: null, cost: CHAT})).toEqual({ok: false, code: "wallet_unread", detail: expect.any(String)});
  });
});
