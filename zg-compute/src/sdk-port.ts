import {createRequire} from "node:module";
import type {ZGComputeNetworkBroker} from "@0gfoundation/0g-compute-ts-sdk";
import {Contract, JsonRpcProvider, Wallet} from "ethers";
import type {Address} from "viem";
import type {ZgLedger, ZgLedgerLimits, ZgPort, ZgProviderModel, ZgService, ZgSubAccount} from "./port";

/*
 * The ZgPort over `@0gfoundation/0g-compute-ts-sdk` 0.9.0 and ethers 6, for one server wallet.
 *
 * Two SDK behaviours are deliberately avoided:
 *  - `inference.getRequestHeaders` runs `checkAndFund` first, which can move up to
 *    unsettled + 2 x 1 0G from the ledger to the provider on its own, outside any lock or cap.
 *    `authHeaders` uses the request processor's `getHeader`, which builds the same single-use
 *    Authorization header and moves nothing.
 *  - `inference.acknowledgeProviderSigner` opens a missing sub-account with 1 0G by itself. The
 *    adapter always funds the sub-account first, so by the time it acknowledges there is nothing
 *    left for the SDK to open. (The SDK treats ANY failed account read as missing, so an RPC error
 *    at that moment moves 1 0G from the ledger to that provider: still the gateway's, locked with
 *    the provider until refunded, and inside the ledger total the cap counts.)
 */

export const ZG_MAINNET_CHAIN_ID = 16661;
/** docs/research/CONSTANTS.md, "0G mainnet (16661)". */
export const ZG_MAINNET_RPC = "https://evmrpc.0g.ai";

const LEDGER_LIMITS_ABI = ["function MIN_ACCOUNT_BALANCE() view returns (uint256)", "function MIN_TRANSFER_AMOUNT() view returns (uint256)"];

// 0G's RPC answers a reverted eth_call with "0x", which ethers reports as BAD_DATA; getLedger and
// getAccount revert for a wallet that has no ledger or sub-account. That is a state, not a fault.
// Anything else (timeouts, connection errors, 5xx) is an unreadable read and must stay an error.
function isMissing(err: unknown): boolean {
  const code = (err as {code?: unknown})?.code;
  if (code === "BAD_DATA" || code === "CALL_EXCEPTION") return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /could not decode result data|BAD_DATA|execution reverted|CALL_EXCEPTION|LedgerNotExists|AccountNotExists/i.test(msg);
}

const PAGE = 50; // listService reverts LimitTooLarge above 50
const PAGE_CAP = 20;

export interface SdkPortConfig {
  /** The 0G wallet's private key. Kept inside the ethers Wallet; never logged. */
  privateKey: string;
  rpcUrl?: string;
}

export async function createSdkPort(cfg: SdkPortConfig): Promise<ZgPort> {
  const rpc = new JsonRpcProvider(cfg.rpcUrl ?? ZG_MAINNET_RPC);
  const pk = cfg.privateKey.startsWith("0x") ? cfg.privateKey : `0x${cfg.privateKey}`;
  const wallet = new Wallet(pk, rpc);
  // The SDK's ESM build does not load under Node (its chunk is a .js file in a package without
  // "type": "module", so Node reads it as CommonJS and the named exports are missing). Its CommonJS
  // build loads; it is required lazily here so tests and fake runs never load the SDK at all.
  const sdk = createRequire(import.meta.url)("@0gfoundation/0g-compute-ts-sdk") as typeof import("@0gfoundation/0g-compute-ts-sdk");
  const broker: ZGComputeNetworkBroker = await sdk.createZGComputeNetworkBroker(wallet);
  const network = await rpc.getNetwork();
  const chainId = Number(network.chainId);
  const ledgerAddress = chainId === ZG_MAINNET_CHAIN_ID ? sdk.CONTRACT_ADDRESSES.mainnet.ledger : sdk.CONTRACT_ADDRESSES.testnet.ledger;
  const ledgerLimits = new Contract(ledgerAddress, LEDGER_LIMITS_ABI, rpc);
  let limits: Promise<ZgLedgerLimits> | null = null;

  const toService = (s: ZgService & Record<string, unknown>): ZgService => ({
    provider: s.provider as Address,
    serviceType: String(s.serviceType ?? ""),
    url: String(s.url ?? ""),
    model: String(s.model ?? ""),
    inputPrice: BigInt(s.inputPrice ?? 0n),
    outputPrice: BigInt(s.outputPrice ?? 0n),
    updatedAt: BigInt(s.updatedAt ?? 0n),
    verifiability: String(s.verifiability ?? ""),
    additionalInfo: String(s.additionalInfo ?? ""),
    teeSignerAddress: String(s.teeSignerAddress ?? ""),
    teeSignerAcknowledged: Boolean(s.teeSignerAcknowledged),
  });

  return {
    address: wallet.address as Address,
    async chainId() {
      return chainId;
    },
    async walletBalance() {
      return rpc.getBalance(wallet.address);
    },
    async listServices() {
      const out: ZgService[] = [];
      for (let page = 0; page < PAGE_CAP; page++) {
        const batch = await broker.inference.listService(page * PAGE, PAGE, true);
        out.push(...batch.map((s) => toService(s as unknown as ZgService & Record<string, unknown>)));
        if (batch.length < PAGE) break;
      }
      return out;
    },
    async providerModels(provider) {
      const r = await broker.inference.getProviderModels(provider);
      return r.models as unknown as ZgProviderModel[];
    },
    ledgerLimits() {
      limits ??= (async () => {
        const [minAccountBalance, minTransferAmount] = (await Promise.all([ledgerLimits.getFunction("MIN_ACCOUNT_BALANCE")(), ledgerLimits.getFunction("MIN_TRANSFER_AMOUNT")()])) as [bigint, bigint];
        return {minAccountBalance, minTransferAmount};
      })().catch((e) => {
        limits = null;
        throw e;
      });
      return limits;
    },
    async getLedger(): Promise<ZgLedger | null> {
      try {
        const l = await broker.ledger.getLedger();
        return {availableBalance: BigInt(l.availableBalance), totalBalance: BigInt(l.totalBalance)};
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async addLedger(wholeZg) {
      await broker.ledger.addLedger(Number(wholeZg));
    },
    async depositFund(wholeZg) {
      await broker.ledger.depositFund(Number(wholeZg));
    },
    async getSubAccount(provider): Promise<ZgSubAccount | null> {
      try {
        const a = await broker.inference.getAccount(provider);
        return {balance: BigInt(a.balance), pendingRefund: BigInt(a.pendingRefund), acknowledged: Boolean(a.acknowledged)};
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async transferFund(provider, neuron) {
      await broker.ledger.transferFund(provider, "inference", neuron);
    },
    async acknowledge(provider) {
      await broker.inference.acknowledgeProviderSigner(provider);
    },
    async authHeaders(provider) {
      const h = await broker.inference.requestProcessor.getHeader(provider);
      return {Authorization: h.Authorization};
    },
    async processResponse(provider, chatId, usage) {
      return broker.inference.processResponse(provider, chatId, usage);
    },
  };
}
