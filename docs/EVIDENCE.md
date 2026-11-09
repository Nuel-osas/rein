# Evidence

Every claim below can be checked in an explorer. Signatures are on Solana devnet unless noted; the
0G runs were paid on 0G mainnet (chain 16661) by the gateway's wallet or its 0G Private Computer key.

## Paid 0G runs, 2026-11-09

One real paid run of each of `ai-image`, `ai-voice`, `ai-claude`, `ai-gpt` and `ai-video` (`ai-chat`
was not re-run that day), bought for the demo team (Acme Research,
`EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5`) by its research agent (spender
`GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d`) through `POST /api/compute/buy`, then
`POST /api/compute/run` (and `GET /api/compute/result/<intent>` for the clip). They ran on a local
production build of this branch (`next build && next start`, port 4340) with the production store
(Redis and Postgres), the gateway's 0G wallet and the 0G Private Computer key; nothing was deployed.
Pending payments were approved with `POST /api/demo` (`approve`), signed by the demo owner key.

| Service | Input | Intent | Price (test USDC) | Payment | Devnet signatures | Payment account | `verified` | 0G provider | Output |
|---|---|---|---|---|---|---|---|---|---|
| `ai-image` | A purple padlock on a black background, flat vector icon, white outline | `czZeMdwWN1I1doP7dOSgKLN2I_hRMiEg` | 0.02 | paid inside the policy | [`2g8TQiyY9U…`](https://explorer.solana.com/tx/2g8TQiyY9Uoy3w7W55DACchFoxWZqagqtVZCzNKanWsi3pJZEy7UPXii8nk56V6MEhvqgw9VqyW5xQDHMfnSa4Ku?cluster=devnet) | [`dz8U9q8A…`](https://explorer.solana.com/address/dz8U9q8AzB3LSFqLK59zGTU2UzB7Ysg9bkt2jXhRwPf?cluster=devnet) | **true**, covers `output` | `0x59E598DB6E8c63D7fEeB64a69De36510a221C762` (wallet route, TeeML) | One 1024 x 1024 JPEG, 42,360 bytes, sha256 `98cceef2…7112bb4`, served by the blob route with the same hash. Cost 0.06261295 0G |
| `ai-voice` | a 3.9 s WAV made with macOS `say` ("Rein pays for this transcript on zero G, under a spending limit.") | `cc86OLO9Lz86i7JkadO48l6dUfooZ9q1` | 0.02 | paid inside the policy | [`3ijbihkHiu…`](https://explorer.solana.com/tx/3ijbihkHiu95yWy32pjcttmN7AzAJKCxmBda2fmUueYthL1FEYiLqxv6btg3zwPujcVFRbSDBX2JNeXLeUT1uur5?cluster=devnet) | [`HdAnUjot…`](https://explorer.solana.com/address/HdAnUjotG2ZhbKZfsFfppE1xWKYuPsb5xu6k55ZTyi3y?cluster=devnet) | **true**, covers `output` | `0xE63C4F83abFbDFCaB884247EaC21f59e2e8d502e` (wallet route, TeeML) | "Rain pays for this transcript on 0G, under a spending limit." Cost 0.00370264 0G |
| `ai-claude` | In one sentence, why should an AI agent that pays for things have a spending limit? | `cV66jvx09mXGf9z1nWxP4JMO9bFzt8cb` | 0.01 | Pending (`service_not_allowed`), approved on /api/demo | [`5xs6sr72Sk…`](https://explorer.solana.com/tx/5xs6sr72SkszRueciXDCbMpYvFcBMabavK2Co1pZVPPWdJzD49muDU6mhhCDdKMonHFCxKNRD67FQwyW82RKmtQ?cluster=devnet) then approve [`3mt4qX6zHP…`](https://explorer.solana.com/tx/3mt4qX6zHPgHJuDKZQF2H5zjgZoErkbZkci9czjAZVPSB6WGSJSoy8dZkifNpZp5gMk4LwCLMkFRnMmzTsXgyfnF?cluster=devnet) | [`3Et73Ftm…`](https://explorer.solana.com/address/3Et73FtmRhUCGhGiF1FZhHizmv7zzM4g7z2QCPV8WDGS?cluster=devnet) | false, covers `none` (relayed, no TEE) | `0x000000003f486c7198d6203568a98d02b91f8044` (0G Router, standard) | A one-sentence answer from `claude-haiku-5.5` (max 200 tokens for this check). Cost 0.000379513 0G |
| `ai-gpt` | the same prompt | `chAx0JamZbs92hhVcPa4VExO80WfDbd_` | 0.01 | Pending (`service_not_allowed`), approved on /api/demo | [`5x1WS8anCm…`](https://explorer.solana.com/tx/5x1WS8anCmMvMgEgX3MrobMWCL8iB7j4i5RvcmKnXS5Ln2WCioaj8pQXudJ4mTQgQnBAztyyQr3wBSi3BNVQkwoW?cluster=devnet) then approve [`4v3NmTu3wr…`](https://explorer.solana.com/tx/4v3NmTu3wrzirSixFuakLHpVDnFgtEPFRjZ7fDSkQwymkPdyJCH11NtyjP68krFTHwect3nvAp9XMRdoSY3cJovu?cluster=devnet) | [`CQ7kESs5…`](https://explorer.solana.com/address/CQ7kESs5SS74T2EdF2DwNtaghgUWooWYMzc2cHQSQf7Q?cluster=devnet) | false, covers `none` (relayed, no TEE) | `0x000000003f486c7198d6203568a98d02b91f8044` (0G Router, standard) | A one-sentence answer from `gpt-5.6-luna` (max 200 tokens). Cost 0.000280696 0G |
| `ai-video` | A purple padlock slowly closing on a black background, simple clean animation | `czOFShLVCYHuldnrImYsrs1e7k56Hawv` | 0.43 | Pending (`service_not_allowed`, `over_cap`), approved on /api/demo | [`23e2XGtMkD…`](https://explorer.solana.com/tx/23e2XGtMkDqdXSPR95KAFRdbcsLKXJs6qmNzrM4o2RVqA8ZPZxwM33sAu4QFSCKKrqP3ePXQKsUL1XRRRYa8e2FU?cluster=devnet) then approve [`4nwfJKWFvi…`](https://explorer.solana.com/tx/4nwfJKWFvi3MFCWnFeHLVP8B2LuP8JLUaJJJ3AtaXS9CQXhcLb5Nmqc81eyJh5BfhFgscZa6dKeHL41gemECe6rT?cluster=devnet) | [`Decg8Z4H…`](https://explorer.solana.com/address/Decg8Z4HBshC6BQQGqE9vrV9kwmkCET9N3HPh8oWFRvL?cluster=devnet) | false, covers `none` (relayed, no TEE) | `0x000000003f486c7198d6203568a98d02b91f8044` (0G Router, standard) | A job: `run` answered 202, the result was ready about 46 s after the first result read. One MP4, 598,583 bytes, 864 x 496, 4.04 s (ffprobe), sha256 `15d0f35e…1438b6`. Cost 1.631697683 0G, about 40,800 video tokens at the listed 480p price, inside the quoted worst case of 50,744 |

What the table shows:

- **TEE services are verified.** `ai-image` and `ai-voice` ran on the 0G Compute SDK (wallet
  route); the adapter checked each provider's TEE signature and that it commits to the delivered
  bytes before the gateway delivered them (`covers: output`).
- **Relayed services say so.** `ai-claude`, `ai-gpt` and `ai-video` ran through the 0G Router,
  where 0G lists them as "standard" trust: the gateway reports `verified: false` and `covers: none`
  for every relayed run, whatever the Router's trace says.
- **The policy decided each payment.** The 0.02 runs settled inside the agent's policy (0.05 per
  payment, 0.50 per hour). Claude and GPT are not on its list, so each was filed Pending with
  `service_not_allowed`; the clip was also over the cap (`over_cap`). The gateway ran each only after
  the owner's approval settled it.
- **The gateway checked the payment, not the client.** Each run read the Payment account derived
  from the quoted spender and intent and checked owner, status, team, spender, service, payee
  (the gateway token account `EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5`) and amount.

After the image and voice runs the gateway's 0G wallet held 17.48 0G outside its ledger (read
with the adapter's `funds()`), and its ledger 5 0G in total with 0.72 0G available, the rest locked
with the providers that served these and earlier runs. 0.72 0G is under the default $0.25 ledger
floor (`ZG_LEDGER_FLOOR_USD`), so wallet-route quotes (chat, image, voice) refuse until the ledger is
topped up from the wallet.

## Registry changes, 2026-11-09

| Change | Signature | Checked by |
|---|---|---|
| Register `ai-image` | [`T4g6oBynG7…`](https://explorer.solana.com/tx/T4g6oBynG7X7VxmaA5tsRHhtGa2Xfzo7fM1385vBUZu8zaQ7Exnocf1QWHvy5rGYjtYGx9fpKnFkWPUqWqcmPow?cluster=devnet) | `scripts/compute-setup.ts` fetched the Service: payee = gateway token account, active |
| Register `ai-voice` | [`4SwVvZRYww…`](https://explorer.solana.com/tx/4SwVvZRYwwkNaKskujqn2YcdGZwVegbG8MbkfxaNjeLFeqYrXkpWYgxirCVbEEPGy96gUJkaty5JXZ6iLc385gXq?cluster=devnet) | same |
| Register `ai-claude` | [`37LCt54uEx…`](https://explorer.solana.com/tx/37LCt54uEx1mb6gu2NDZRrgkBF9GvR7sw49fBsSJ9qPFQVgSQtA91Q3Yfc6QqgK9gaU6nwZ9A6QaCUCLrJkvfrQB?cluster=devnet) | same |
| Register `ai-gpt` | [`2DRuJBxhmV…`](https://explorer.solana.com/tx/2DRuJBxhmVMoazhpVtivjSWoSWRvrm8LPprQR3wUfgWjbhkK5uv9J74H6uQ27yEVgoMdoYKA6rwtn8tYQWmVSWv5?cluster=devnet) | same |
| Register `ai-video` | [`3JFMSoAfcH…`](https://explorer.solana.com/tx/3JFMSoAfcHZgkmPxmGXmYxoWhazSmoC3ThkZjcHvLpq6kXQpARYMEWnbNFhvzrSocAwSJCY9iRh9tscWpZ4cTUtB?cluster=devnet) | same |
| Suspend `web-search` | [`4B4cidsYU4…`](https://explorer.solana.com/tx/4B4cidsYU4DE6XuLNzks2yBecuUNWjkeWym5GZ2fpWpCLWvkYYExa1uF7eL3CZvPpEawvKE6zjQamZ6i4LpiyhLm?cluster=devnet) | the script fetched the Service: active = false |
| Suspend `llm-inference` | [`4HEJTbkoYy…`](https://explorer.solana.com/tx/4HEJTbkoYyGj5oo3r2iuUyMggnTyvYPNky13iPzeahmN5Dd2NFaQhuQGSAQroBUCw8sJHnQwSbT38nT7rqRF26kH?cluster=devnet) | same |
| Suspend `market-data` | [`2nTYuYLFPp…`](https://explorer.solana.com/tx/2nTYuYLFPp8qWivJtiaJX9k7qATrjjRxwmETA9k4jouCAjAgqrVTCZqj5Go1x7VJj5YUJUA3ZHb7KhuG4RPhF7Uf?cluster=devnet) | same |
| Suspend `gpu-hour` | [`2hHCpSWF5S…`](https://explorer.solana.com/tx/2hHCpSWF5SX6FRwzuPwHeD4DPVu1DYkegWaSQS4qZ3yW1xHgVcjQXDCahqEofVWDB143KVbiwyzTNp4So8bzo5b5?cluster=devnet) | same |
| Suspend `premium-dataset` | [`5ooh15GmE1…`](https://explorer.solana.com/tx/5ooh15GmE1eENzAE6kTAvxNgSqpffTLk8asMKrTLEm8efC3zbbGnJpgUYs1LirLbQBH7yrHd6EmXgjTejqdCSVzF?cluster=devnet) | same |
| Demo agent `set_services` [ai-chat, ai-image, ai-voice] | [`2yKL9mtqt2…`](https://explorer.solana.com/tx/2yKL9mtqt2db2ktP7qh3kzqyrVWFAFfNmYcqn3wfroSn5emrXrsSFHQzatquVuaVC7iipSuQ6B6xu1L5N1zUainT?cluster=devnet) | `scripts/demo-agent.ts` fetched the Spender afterwards |
| Demo agent `set_policy` (cap 0.05, 0.50 per hour, 20 payments) | [`59ZBuLTyK7…`](https://explorer.solana.com/tx/59ZBuLTyK79fQdjsNxb7C14RKvxEMc4dzzQ2A3pQKCnDFXxosg7cT9GaJeeisPsK5LkKTUxphuCCYYtNDnvS3ueM?cluster=devnet) | same |

Every signature in this file was read back with `getSignatureStatuses` on 2026-11-09: finalized,
no error.

## Earlier evidence (2026-11-08, placeholder services since suspended)

These ran on the first demo's stand-in services (web-search, gpu-hour), which delivered nothing
and were suspended on 2026-11-09 (above). They still show what the program does: settle inside a
policy, file over a limit, refuse a made-up service and a wrong payee.

<!-- evidence:start -->
## Run of devnet, 2026-11-08T03:40:06.698Z)

Program `F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`. Throwaway team `7Gw1ANMy2qybMUoujc7FeRpkhYqTES8U1WaHdJHWW1vK`. Agent `Dd6Qm6TmDtra1mvfcaUDvnZ2aTeBhqMFKBvMhp6SrUBJ` (0 SOL; the sponsor `hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF` pays fees and rent).

| Claim | Result | Transaction |
|---|---|---|
| Agent with 0 SOL pays 0.40 USDC for web-search inside its policy | paid | [4Ygd81XkNo…](https://explorer.solana.com/tx/4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6?cluster=devnet) |
| Agent asks for 9 USDC of GPU time, over its 5 USDC cap: filed for the owner | pending (over_cap) | [w1VEqKk3ic…](https://explorer.solana.com/tx/w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo?cluster=devnet) |
| Owner approves; the 9 USDC settles in the same transaction | settled | [3PTN2Q5CYH…](https://explorer.solana.com/tx/3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa?cluster=devnet) |
| Prompt-injected agent tries a made-up service "wallet-9xqe" | refused on chain: AccountNotInitialized | [5veVH6qrhh…](https://explorer.solana.com/tx/5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA?cluster=devnet) |
| Agent passes an attacker token account as the web-search payee | refused on chain: WrongPayee | [4uZN8NEASQ…](https://explorer.solana.com/tx/4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr?cluster=devnet) |

Re-run: `REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence`
<!-- evidence:end -->
