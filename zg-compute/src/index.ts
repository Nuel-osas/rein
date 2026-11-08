import {createZgComputeWith, type ZgCompute, type ZgComputeOptions} from "./backend";
import {createSdkPort} from "./sdk-port";

/*
 * @rein/zg-compute: the 0G Compute Network adapter for the commerce gateway.
 *
 *   const compute = await createZgCompute({privateKey: env.GATEWAY_ZG_PRIVATE_KEY});
 *   await compute.priceOf(op);       // worst case in neuron + USD per 0G, or why not
 *   await compute.run(op, input, {purchaseId});
 *
 * Server only: it holds the 0G wallet's key.
 */

export interface ZgComputeConfig extends ZgComputeOptions {
  /** The gateway's 0G wallet key (GATEWAY_ZG_PRIVATE_KEY). */
  privateKey: string;
  /** Default https://evmrpc.0g.ai. */
  rpcUrl?: string;
}

export async function createZgCompute(config: ZgComputeConfig): Promise<ZgCompute> {
  const {privateKey, rpcUrl, ...opts} = config;
  const port = await createSdkPort({privateKey, rpcUrl});
  return createZgComputeWith(port, opts);
}

export {API_FUNDING_SNAPSHOT_MS, AUDIO_STATED_TOLERANCE, AUDIO_TOLERANCE_SECONDS, BINDING, coversOf, createZgComputeWith, DEFAULT_TIMEOUTS_MS, isZgOperation, type ProviderView, type ZgCompute, type ZgComputeOptions, type ZgOperation, type ZgOperationId} from "./backend";
export {anthropicStreamToOpenAi, fromAnthropicMessage, toAnthropicBody, type AnthropicProblem} from "./anthropic";
export {createZgApi, type ZgApi, type ZgApiCatalog, type ZgApiKind, type ZgApiModel, type ZgChatCall, type ZgChatRequest} from "./api";
export {AUDIO_COUNT_CEILING_SECONDS, audioLength, sniffAudio, type AudioFormat, type AudioLength} from "./audio";
export {createSdkPort, ZG_MAINNET_CHAIN_ID, ZG_MAINNET_RPC, type SdkPortConfig} from "./sdk-port";
export type {ZgLedger, ZgLedgerLimits, ZgPort, ZgProviderModel, ZgService, ZgSubAccount} from "./port";
export {FAILURES, type FailureCode} from "./failure";
export {DEFAULT_FUNDING, planFunding, requiredLocked, type FundingConfig, type FundingPlan} from "./funding";
export {relayedAllowed, resolveProviders, signingAddressOf, trustOf, type ResolvedProvider, type Trust} from "./providers";
export {costFromUsage, unitPrices, videoTokenEstimate, worstCase, VIDEO_SECONDS, VIDEO_SIZE, type UnitPrices, type Usage} from "./pricing";
export {createRateSource, rateFromCatalog, RATE_BAND, ROUTER_CATALOG_URL, type Rate} from "./rate";
export {formatZg, NEURON_PER_ZG, neuronToZgNumber} from "./units";
export type {ZgEvent} from "./ops";
export {CLOSED_MODELS, closedModel, OPERATIONS, operationById, type ClosedModel, type Operation, type OperationId, type RunOutcome} from "./commerce/index";
