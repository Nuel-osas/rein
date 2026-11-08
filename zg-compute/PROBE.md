# Live probe: 0G Compute on mainnet, 15 October 2026

Each of the four operations was run for real on 0G mainnet (chain 16661) through this package's own
adapter (`scripts/probe.mts`), paid from the commerce gateway's 0G wallet
`0x4049Fcfa417D380e19d6543dA5e811278f3d712E`. SDK `@0gfoundation/0g-compute-ts-sdk` 0.9.0,
ethers 6.17. The figures below were read from the chain, from each provider's own unsettled-fee
endpoint and from the responses. Recheck before relying on them: prices follow 0G's USD rate.

0G's own USD rate (median of `pricing_usd` / `pricing` across the Router catalog, 239 priced
fields): **$0.2536 per 0G**.

## Results

| | Chat | Voice | Image | Video |
|---|---|---|---|---|
| Model | `0GM-1.0-35B-A3B` | `openai/whisper-large-v3` | `z-image-turbo` | `dreamina-seedance-2-0-260128` |
| Provider | `0x4870…a4E9` | `0x36aC…4517` | `0xE29a…F974` | `0xE1C4…8309` |
| Request | `POST {url}/v1/proxy/chat/completions`, JSON, `max_tokens` 1024, `chat_template_kwargs.enable_thinking=false` | `POST {url}/v1/proxy/audio/transcriptions`, multipart `file`, `model`, `response_format=json` | `POST {url}/v1/proxy/images/generations`, JSON `n=1`, `size=1024x1024`, `response_format=b64_json`; answered synchronously (200) | `POST {url}/v1/proxy/videos`, multipart `model`, `prompt`, `seconds=4`, `size=480p`; poll `GET …/videos/{id}`; `GET …/videos/{id}/content` |
| Input | one-line prompt | 4.885 s spoken MP3 (20 KB, macOS `say` + ffmpeg) | one-line prompt | one-line prompt |
| Output | 193 characters | "Pay Corvain AI $5 for credits this week, and please send the receipt to the team." | PNG 1024x1024, 818,003 bytes | MP4 864x496, 97 frames at 24 fps (4.04 s), H.264 + AAC audio, 869,476 bytes |
| Usage reported | 46 prompt + 34 completion tokens | `{"type":"duration","seconds":5}` | (none) | `usage.completion_tokens` 40,594 |
| Cost, measured | 0.00007875 0G | 0.0025822 0G | 0.03460438 0G | 1.12002536 0G |
| Cost in USD | ~$0.00002 | ~$0.00065 | ~$0.0088 | ~$0.284 |
| Worst case quoted | 0.00583 0G ($0.0015) | 0.03201 0G ($0.0081) | 0.03595 0G ($0.0091) | 1.5257 0G ($0.39) |
| Latency, first run (includes funding transactions) | 20.1 s | 12.9 s | 32.1 s | 177 s (render ~128 s, final proof ~24 s after) |
| Latency, already funded | 5.1 to 5.7 s | 5.4 to 5.5 s | 8.9 s | (one run only) |
| Signature verified | yes, attempt 1 | yes, attempt 1 | yes, attempt 1 | yes, attempt 5 (the final proof) |

"Cost, measured" is the change in the provider's own unsettled total for the wallet
(`GET {url}/v1/user/{wallet}/unsettledfee`) across the run. For video it was later confirmed by
settlement: the sub-account's locked balance fell by exactly 1.120025363636359946 0G.

Chat and voice were run three times each and image twice (the later runs collected the signature
data below and checked the final code); every run succeeded and verified on the first attempt.

### Units and prices

- **Whisper is billed per second of audio**, against `inputPrice`, rounded to the nearest second
  with a 1 second floor: the 4.885 s clip was billed as 5 s. The price is USD-pegged
  ($0.00013 a second) and moved with the rate between runs: 5.1644e-4 then 5.1019e-4 0G a second.
  (The on-chain `inputPrice` read 5.2477e-4.)
- **Video is billed per vendor "video token"**, not per second: tokens = width x height x frames /
  1024, with 24N + 1 frames for N seconds. 864 x 496 x 97 / 1024 = 40,594.5, exactly what
  ByteDance reported. The 480p, text-only variant costs 2.7591e-5 0G a token ($0.000007).
  Before the run the expected cost was 40,595 tokens x 2.7591e-5 = 1.12 0G, under the 2 0G limit,
  so it ran. Seedance adds an audio track at no extra token cost.
- **Providers bill at the price they publish on their own `/v1/models`**, not the on-chain
  `inputPrice`/`outputPrice`: chat moved the unsettled total by 46 x 3.15e-7 + 34 x 1.89e-6
  (published) where the on-chain prices are 3.2e-7 and 1.92e-6. Published prices are USD-pegged.
  The adapter quotes at the higher of the two and reports cost at the published one.
- The image price is per image (published $0.0088); the on-chain `inputPrice` is 0 and
  `outputPrice` is the per-image price, so the SDK's own fee estimate for images reads 0.

## What the signature covers

Every provider stores a signed text per response at `GET {url}/v1/proxy/signature/{ZG-Res-Key}?model=…`
(EIP-191, recovers to the service's TEE signer). The probe compared its hashes to the bytes sent
and received:

| | Signed text | Request half | Response half |
|---|---|---|---|
| Chat | `sha256(request):sha256(response body)` | does not match the bytes sent (the provider hashes its re-serialized body) | matches the response body byte for byte |
| Voice | `sha256(multipart body):sha256(response body)` | matches | matches |
| Image | `sha256(request):sha256(image bytes)` | matches | matches the delivered PNG |
| Video | routing proof `request:response:centralized:bytedance:<TLS fingerprint>` | does not match (rewritten body) | create-time proof covers the create response; after the job ends the provider re-signs under the same key over the final status JSON, which matched the final poll body byte for byte |

The adapter enforces every half that matched (`BINDING` in `src/backend.ts`): an output is
delivered only when the signature recovers to the provider's signer and the signed text contains
the hash of what is delivered. For video it also refuses the create-time proof and waits for the
final one.

**Video's "TeeML" is a routing proof.** The service declares TeeML, but its additionalInfo says
`ProviderType: centralized`, `ProviderIdentity: bytedance`: the enclave proves it relayed the job to
ByteDance's API (it pins the TLS certificate) and what the final status said, including the billed
token count. The MP4 bytes are not covered by any signature. The adapter reports this as
`trust: "routed-to-vendor"` from `providers()` and as `covers: "route"` (vendor `bytedance`) on
every video run's proof. Chat, voice and image are `model-in-enclave` and `covers: "output"`.

## Funding observed

- The provider serves a request only while the wallet's locked balance with it covers
  1 0G (`MinimumLockedBalance`) + its unsettled fees + this request's fee
  (0g-serving-broker `ctrl.validateBalanceAdequacy`). A video create is gated only by that minimum
  because Seedance's fee is known after the clip, so the adapter funds the clip's worst case first.
- The SDK opens a ledger with at least 3 0G; the contract's minimum transfer to a provider is 1 0G.
- New sub-accounts came back already acknowledged, so no acknowledge transaction was sent.
- `inference.getRequestHeaders` would have moved up to unsettled + 2 0G per provider on its own;
  the adapter uses `requestProcessor.getHeader` instead (same Authorization header, no transfer).

Ledger transactions (all to the 0G Compute ledger `0x2dE54c845Cd948B72D2e32e39586fe89607074E3`,
all status 1; the wallet's nonce is 7, so these are all of them). Shortened here because the repo's
secrets gate treats any full 32-byte hex run outside the evidence files as a possible key; the
full hashes are in the pull request that added this file, and on chainscan.0g.ai under the wallet.

| What | Transaction |
|---|---|
| Open ledger, 3 0G | `0x6287f0a8…ce5a02fed` |
| 1.05582656 0G to chat | `0xe3b8f49c…465982c50a` |
| 1.08201097 0G to voice | `0x091c1f2d…14ea5a63` |
| Deposit 1 0G | `0xa320b617…e45b77dc` |
| 1.08594697 0G to image | `0x97847441…5bcf922` |
| Deposit 2 0G | `0xa2fc15f8…64af96c8b` |
| 2.5756836 0G to video | `0x73cc917b…b58acf167ab` |

## Where the 20 0G is now

| | 0G |
|---|---|
| Wallet | 13.992781 |
| Gas, 7 transactions | 0.007219 |
| Deposited to the ledger | 6.000000 |
| of which settled to providers (the video) | 1.120025 |
| of which owed, unsettled (chat 0.000255, voice 0.007684, image 0.069209) | 0.077148 |
| of which still the gateway's: locked with providers (chat 1.055827, voice 1.082011, image 1.085947, video 1.455658) less owed, plus 0.200532 available | 4.802827 |

Spent on compute: 1.197 0G (~$0.30). Locked funds come back with `retrieveFund` (24 hour wait)
then `refund`.

## Fixtures

`fixtures/audio/speech-4.9s.mp3` is the probe's input clip; `fixtures/probe-chat.txt` and
`fixtures/probe-voice.txt` are its outputs. The image (818 KB) and the video (869 KB) are over
200 KB and are not committed. `fixtures/audio/tone*` are 2.5 s ffmpeg tones in every accepted
container, for the audio length tests.
