# In Rein

This package is `@rein/zg-compute`. It is adapted from Nuntio by 71Labs, with its author's agreement. The
commerce module it uses (operations, closed models, the `ComputeBackend` seam and input checks) is
vendored in [src/commerce/](src/commerce).

| How Rein uses it | Where |
|---|---|
| Loaded lazily, once per process, by `zgBackend` with the gateway's 0G wallet key and `maxLedgerZg` | [web/lib/server/compute/backend.ts#L34](../web/lib/server/compute/backend.ts#L34) |
| Chosen when `ZG_PRIVATE_KEY` is set and no `ZG_ROUTER_API_KEY` is; with a Router key the gateway uses 0G Private Computer instead, which does not use this package | [web/lib/server/compute/wire.ts#L131](../web/lib/server/compute/wire.ts#L131), [web/lib/server/compute/router.ts#L53](../web/lib/server/compute/router.ts#L53) |
| Rein sells one operation: registry service `ai-chat`, operation `chat`, 0G model `0GM-1.0-35B-A3B` | [web/lib/server/compute/catalog.ts#L34](../web/lib/server/compute/catalog.ts#L34) |
| Gateway wallet, ledger and the first verified production run | [docs/CONSTANTS.md](../docs/CONSTANTS.md) |

Tests: `pnpm test` (vitest). Re-run 2026-11-08: 10 test files, 186 tests, all pass, exit 0.

# @rein/zg-compute

The 0G Compute Network adapter for the compute gateway. It implements `ComputeBackend` from the
vendored commerce module ([src/commerce/](src/commerce)) on 0G mainnet (chain 16661),
using the direct SDK `@0gfoundation/0g-compute-ts-sdk` 0.9.0 and the gateway's own 0G wallet.
Server only: it holds that wallet's key. It imports nothing from `apps/`.

```ts
import {createZgCompute, operationById} from "@rein/zg-compute";

const compute = await createZgCompute({privateKey: process.env.GATEWAY_ZG_PRIVATE_KEY!});
const op = operationById("chat")!;
await compute.priceOf(op);    // {ok, maxCostNeuron, usdPerZg, revision} or {ok: false, reason}
await compute.run(op, {prompt: "..."}, {purchaseId: quoteId, signal});
await compute.status();       // {ledgerNeuron, reason}
await compute.providers();    // who serves each operation, and what its enclave covers
await compute.funds();        // {wallet, ledger}: the wallet's own 0G and the ledger, read only (for /health)
```

Live results, request shapes, prices and what each signature covers: [PROBE.md](./PROBE.md).

## What it does

- **Providers** are resolved from `listService` every run (all pages), never configured. Only
  services that list the operation's exact model and type, declare TeeML and have an acknowledged
  TEE signer are used; anything else is refused before money moves. One exception, by name: a
  closed model whose entry in commerce's `CLOSED_MODELS` says `relayed` (Claude Fable 5, Claude
  Opus 5) may be served by a provider 0G lists as `standard` (no TEE), still listed by 0G and https;
  never any other model. A closed model's trust and vendor come from that list, not from 0G's
  `ProviderType` (GPT-5.4 mini's TeeML broker relays to OpenAI: `routed-to-vendor`).
- **priceOf** returns the most one run within the operation's limits can cost, in neuron, from the
  provider's live prices (the higher of on-chain and its published `/v1/models` price, raised by the
  largest tier multiplier it publishes), read from a fresh service list, and 0G's USD rate from the
  Router catalog (median, cached up to 10 minutes, refused outside $0.02 to $20). It does not quote
  when a provider's published prices cannot be read (they follow 0G's USD rate and can sit above
  the on-chain ones). It also returns `ok: false` when the float cannot pay for that run, so the
  gateway never takes money for work it cannot buy. `revision` names the provider, unit prices,
  rate and time.
  - chat: 4,000 characters at 3 tokens each (a hard ceiling for any text) + 64, and 1,024 output tokens
  - voice: 61 seconds (the limit plus the provider's rounding), billed per second, plus 896
    transcript tokens at the output price (0 today)
  - image: one image
  - video: 4 s at 480p, 864 x 496 x 97 / 1024 = 40,595 tokens, at the dearest known per-token price, x 1.25
- **run** funds the provider sub-account under a per-wallet lock, runs once, verifies, and reports
  cost from the usage the provider reported, at the price it bills.
  - Funding re-reads balances every run. The provider needs 1 0G + its unsettled fees + this fee
    locked; the adapter adds the run's worst case and a 5% margin, tops up by at least the
    contract's 1 0G minimum, opens the ledger with 3 0G, keeps 0.1 0G for gas, and never lets
    the ledger's total (available plus locked) pass `maxLedgerZg` (default 10). A provider adds a
    run's fee to its unsettled total only when it answers, so the worst case of every run still
    working on a provider is held and counted as open too (two clips at once get two clips'
    worth).
  - Verification fails closed: `processResponse` (retried while the signature is not published
    yet), then the signed text must contain the hash of what is delivered (`BINDING`). Video is
    checked directly (the SDK cannot) and only its final proof is accepted.
  - Voice audio is measured from its bytes, because the provider bills the length it actually
    plays: an upper bound on what a decoder plays, counted from the coded frames (Opus TOC bytes,
    AAC samples, MP3 frames, PCM bytes) over the whole file, resyncing over junk as decoders do,
    never from a Duration, mvhd, granule or Xing figure that says less (`src/audio.ts`). WAV (PCM
    or float), MP3, M4A (AAC, also fragmented), Ogg and WebM (Opus or Vorbis, also browser
    recordings without a duration). Audio over the limit, more than a second or a tenth longer
    than the length it was priced for (`input.audio.seconds`), or that cannot be measured is
    refused before anything is spent. A crafted file can make the reader refuse, never hang.
  - Deadlines: chat 120 s, voice 120 s, image 180 s, video 10 min. The caller's signal aborts.
  - A second `run` for the same `purchaseId` while the first is working returns the same promise.
  - It never retries the work itself. A failure is exactly `{ok: false, code, retryable, message}`
    with a person's `message`; the provider's own words reach only the log, as `detail` on the
    `run.fail` and `run.refused` events passed to `onEvent`, with any bearer credential redacted.
    Provider bodies are read up to a cap (32 MB for answers, 200 MB for a video), never whole.

## For the gateway

- `run` resolves `{ok: true, output, proof, costNeuron}`; `costNeuron` can be null when the
  provider reported no usage. `proof.verified` is true on success, except for a relayed closed
  model (`claude`), whose proof is `{verified: false, covers: "none", vendor: "Anthropic"}`: nothing
  is signed, the answer is delivered unchecked, and that is not a failed check (0G's SDK answers
  `processResponse` false for a non-verifiable service while still billing it, so it is never
  asked). `proof.covers` says what the signature covers: `"output"` (the delivered bytes) for chat,
  voice and image, `"route"` for video and GPT, with `proof.vendor` naming who made it. Do not
  present a `"route"` proof as a proof of the clip or the answer.
- A `standard` provider needs the same sub-account and acknowledgement transaction as a TEE one:
  the SDK's auth header (`getHeader`) refuses any provider this wallet has not acknowledged. The
  funding plan already does both.
- `scripts/closed-probe.mts`: the three closed models, read only by default (providers, prices,
  trust, worst case of a 1,024-token answer); `--send --env <file>` makes one paid call per model.
- `output.bytes` for image and video is in memory (video ~1 MB at 480p); store it, do not keep it.
- **Video's proof is a routing proof** (`providers()` says `trust: "routed-to-vendor"`,
  vendor `bytedance`, and every video run's proof says `covers: "route"`): it covers the relay to
  ByteDance and the final status with the billed token count, not the MP4 bytes. Chat, voice and
  image are `model-in-enclave`.
- **A quote is a price at a moment.** `run` resolves the provider again and funds that run's worst
  case; if the provider set or its prices change between quote and run, the run can cost more
  than the quote said. The gateway sees it in `costNeuron`.
- **Ledger headroom**: each provider settles fees in batches out of its locked balance, and every
  run first needs its own worst case locked on top of the open fees. After a few runs expect about
  2 0G locked per chat, voice or image provider, and 1 0G + open fees + 1.53 0G for video, so the
  default 10 0G cap allows about one or two videos before the provider settles. Raise
  `maxLedgerZg` if video sells.
- `retryable: true` on `provider_balance` means the provider wanted more locked than the
  adapter's estimate of its open fees; the next run re-reads them.
- Rate limits seen: 30 requests a minute for voice and image, 200 for chat and video.
- One process per wallet: the lock is in-process.

## Files

- `src/backend.ts`: `createZgComputeWith(port, options)`, the four calls, `BINDING`.
- `src/api.ts`: `compute.api`, the pass-through behind OpenAI-compatible AI keys: `catalog()` (every chatbot
  model a usable TEE provider serves, cheapest provider each, plus whisper and z-image-turbo, with
  quote-safe unit prices and 0G's rate) and `chat()` (funds the request's worst case under the same
  wallet lock and holds as `run`, sends the OpenAI body to `/chat/completions`, hands back the
  response with `verify` and `finish`). A full funding reading younger than 30 s that still covers
  a request after every hold and every run ended since stands in for a fresh one, so API calls do
  not queue behind each other's ledger reads; `run` always reads fresh.
- `src/sdk-port.ts`: the port over the SDK and ethers (the only file that touches them).
- `src/ops.ts`: request shapes and response parsing per operation.
- `src/pricing.ts`, `src/funding.ts`, `src/rate.ts`, `src/verify.ts`, `src/audio.ts`, `src/providers.ts`.
- `scripts/probe.mts`: the live probe (spends real 0G; see its header).

`pnpm --filter @rein/zg-compute typecheck` and `test` (no network: the broker and fetch are faked).
