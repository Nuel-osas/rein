import type {Address} from "viem";
import type {RunInput} from "./input";
import type {Operation} from "./operations";

/*
 * The seam between the gateway (apps/gateway) and whatever does the work (packages/zg-compute for
 * 0G today). Types only: the gateway is built and tested against this with a fake, and the 0G
 * adapter implements it.
 */

export type RunOutput =
  | {kind: "text"; text: string}
  | {kind: "image"; mimeType: string; bytes: Uint8Array}
  | {kind: "video"; mimeType: string; bytes: Uint8Array};

export interface RunProof {
  /** "x402" when the run was bought over x402 rather than run on 0G; absent for 0G runs. */
  backend?: "x402";
  /** The upstream payment's settlement transaction, for x402 runs. */
  settlement?: {network: string; txHash: `0x${string}`};
  /** The provider that did the work. */
  provider: Address;
  model: string;
  /** The provider's id for the response, used to fetch its signature; null when it gave none. */
  chatId: string | null;
  /** True only when the response's TEE signature checked out against the provider's signer. */
  verified: boolean;
  /**
   * What that signature covers. "output": the delivered bytes (their hash is in the signed text).
   * "route": only that the enclave relayed the job to a vendor and what the vendor's final status
   * said; the delivered bytes are not covered (0G video today: the MP4 is fetched unsigned).
   * "none": nothing is signed (a "relayed" closed model, models.ts): `verified` is false and that is
   * not a failure; the answer is delivered and labelled unchecked.
   * Optional for backends that predate it: treat a missing value as unknown, never as "output".
   */
  covers?: "output" | "route" | "none";
  /** The vendor whose API did the work when the provider relays rather than runs the model (for example "bytedance"); null when the model ran in the provider's own enclave. */
  vendor?: string | null;
  /** Wall-clock seconds the run took. */
  seconds: number;
}

export type RunOutcome =
  | {ok: true; output: RunOutput; proof: RunProof; costNeuron: bigint | null}
  | {
      ok: false;
      /** True when trying again (the same provider or another serving the model) may succeed. */
      retryable: boolean;
      /** A short, stable code for logs and tests. */
      code: string;
      /** A person's words; never a provider's raw error. */
      message: string;
    };

export type PriceOutcome =
  | {ok: true; amountAusd: bigint; revision: string}
  | {
      ok: true;
      /** The most one run within the operation's limits can cost, in neuron (10^18 neuron = 1 0G). */
      maxCostNeuron: bigint;
      /** US dollars per whole 0G, as used for this price. */
      usdPerZg: number;
      /** Which inputs produced it: provider, unit prices, rate source and time. */
      revision: string;
    }
  | {ok: false; reason: string};

export interface ComputeStatus {
  /** Available balance in the 0G ledger, neuron; null when it could not be read. */
  ledgerNeuron: bigint | null;
  /** Why the backend will not take new work, in a person's words; null when it will. */
  reason: string | null;
}

export interface ComputeBackend {
  status(): Promise<ComputeStatus>;
  /** The worst-case price of one run of `op` right now. Never cached across a provider change. */
  priceOf(op: Operation): Promise<PriceOutcome>;
  /**
   * Run `op` once. `purchaseId` is the quote id: the backend uses it for its own idempotency and
   * logs. It never retries on its own across providers in a way that could bill twice for one
   * delivered result.
   */
  run(op: Operation, input: RunInput, opts: {purchaseId: string; signal?: AbortSignal}): Promise<RunOutcome>;
}
