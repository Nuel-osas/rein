import type {Address} from "viem";

/*
 * The narrow surface of the 0G Compute Network the adapter uses. `sdk-port.ts` implements it over
 * `@0gfoundation/0g-compute-ts-sdk` and ethers; the tests implement it with a fake. Nothing here
 * sends a request to a provider's inference endpoint: that is plain HTTP through `fetch`.
 *
 * Reads distinguish "does not exist" (null) from "could not be read" (throws), so an RPC outage is
 * never mistaken for an empty account.
 */

/** One row of `InferenceServing.listService`. Prices are neuron per unit. */
export interface ZgService {
  provider: Address;
  serviceType: string;
  url: string;
  model: string;
  inputPrice: bigint;
  outputPrice: bigint;
  updatedAt: bigint;
  verifiability: string;
  additionalInfo: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
}

/** One model as the provider's own `/v1/models` publishes it; only the fields used here. */
export interface ZgProviderModel {
  id: string;
  type?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    video?: string;
    video_unit?: string;
    variants?: {dimensions?: Record<string, string>; unit?: string; unit_price?: string}[];
    /** Multipliers on the prompt and completion prices by prompt size (the broker's tiered pricing). */
    tiered_pricing?: {max_input_tokens?: unknown; input_multiplier?: unknown; input_multiplier_denominator?: unknown; output_multiplier?: unknown; output_multiplier_denominator?: unknown}[];
  };
}

export interface ZgLedger {
  /** Not yet moved to any provider. */
  availableBalance: bigint;
  /** Available plus everything locked in provider sub-accounts. */
  totalBalance: bigint;
}

export interface ZgSubAccount {
  balance: bigint;
  pendingRefund: bigint;
  /** Whether this wallet has acknowledged the provider's TEE signer. */
  acknowledged: boolean;
}

export interface ZgLedgerLimits {
  /** The contract's minimum to open a ledger, neuron. */
  minAccountBalance: bigint;
  /** The contract's minimum for one transfer to a provider, neuron. */
  minTransferAmount: bigint;
}

/** A provider's stored signature for one response: EIP-191 over `text`. */
export interface ZgSignature {
  text: string;
  signature: string;
}

export interface ZgPort {
  /** The 0G wallet. */
  readonly address: Address;
  /** The chain the wallet is connected to. */
  chainId(): Promise<number>;
  /** The wallet's own 0G (pays deposits and gas). */
  walletBalance(): Promise<bigint>;
  /** Every listed service, all pages, acknowledged or not. */
  listServices(): Promise<ZgService[]>;
  /** The provider's published models and prices; throws when unreachable. */
  providerModels(provider: Address): Promise<ZgProviderModel[]>;
  ledgerLimits(): Promise<ZgLedgerLimits>;
  /** Null when the wallet has no ledger yet. */
  getLedger(): Promise<ZgLedger | null>;
  /** Opens the ledger with whole 0G. */
  addLedger(wholeZg: bigint): Promise<void>;
  /** Adds whole 0G to an existing ledger. */
  depositFund(wholeZg: bigint): Promise<void>;
  /** Null when the wallet has no sub-account with this provider yet. */
  getSubAccount(provider: Address): Promise<ZgSubAccount | null>;
  /** Moves neuron from the ledger into the provider sub-account. */
  transferFund(provider: Address, neuron: bigint): Promise<void>;
  /** Acknowledges the provider's TEE signer for this wallet (a transaction). */
  acknowledge(provider: Address): Promise<void>;
  /** Single-use auth headers for one request. Never moves funds (unlike the SDK's getRequestHeaders). */
  authHeaders(provider: Address): Promise<Record<string, string>>;
  /** The SDK's processResponse: true signed by the signer, false mismatch, null not checked. */
  processResponse(provider: Address, chatId: string, usage?: string): Promise<boolean | null>;
}
