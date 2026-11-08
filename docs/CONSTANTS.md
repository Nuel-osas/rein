# Constants

Every address the code and the demo use, with how it was verified. When code and this file disagree,
this file wins and the code is the bug. All of it is **devnet**; nothing here holds real money.

## Program (devnet, 2026-11-08)

| What | Value | Verified by |
|---|---|---|
| Program id | `F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe` | Deploy tx [`2dGZ8Pw9…`](https://explorer.solana.com/tx/2dGZ8Pw9sq9mVJ1q5dJtYtwqWZxWF4cHqv76khz8Cc2VoyxzxvMhsTjA21vo58ax4Ud82hJQsS5nAgQiD1h9o3Ju?cluster=devnet). `solana program show` reports data length 360400 bytes, the size of `target/deploy/rein.so` built from `programs/rein` at commit `7c66d98` (sha256 `a060b856ec3cf706…`). Equals `address` in `idl/rein.json` and `declare_id!` in `lib.rs` |
| ProgramData | `24HQcsdBhmhJAdEFk4H1bbCo9WXPyLxCL6ACRaf7usmF` | `solana program show` |
| Upgrade authority | `DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk` (the deployer's CLI wallet) | `solana program show`. On mainnet this would go to a multisig or be removed before money moves. **Not done; devnet only** |

## Registry and token

| What | Value | Verified by |
|---|---|---|
| Config (`["config"]`) | `9wir7aGbR6CHs1Ctf9o5uegvBbaBULZgsf2mbo7kodYF` | PDA derivation in `scripts/lib.ts`; account written by `init_config` during `pnpm seed`, admin = the CLI wallet |
| Test USDC mint | `Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14` | `spl-token display`: 6 decimals, mint authority `9VUaEpHp4Bka2Yce6EtBxNGi5sb3pbd8SvkY75URQ2bx`. Created by `pnpm seed`; `Config.mint` points at it. Not Circle USDC: a mint we control so the demo can top itself up |
| Mint authority | `9VUaEpHp4Bka2Yce6EtBxNGi5sb3pbd8SvkY75URQ2bx` | `spl-token display` above. Key in `~/.config/rein/mint-authority.json` and the Vercel env, never in the repo |

## Services (`["service", id]`)

| Id | Account | List price |
|---|---|---|
| web-search | `8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z` | 0.40 |
| llm-inference | `DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p` | 2.00 |
| market-data | `Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS` | 1.50 |
| gpu-hour | `4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di` | 3.00 |
| premium-dataset | `GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc` | 12.00 |

Registered by `pnpm seed` with `register_service`. Each payee is a fresh keypair in `~/.config/rein/payee-<id>.json`; the payee token accounts are in `deploy/devnet.json`.

## Demo team

| What | Value | Verified by |
|---|---|---|
| Team "Acme Research" (`["team", owner]`) | `EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5` | PDA of the owner below; the same address on every cluster because the program id and owner key are the same |
| Vault | `FdPTBxs2FcN4L5bHHUuXpDi2x6aYcnn5q7bpDisnaJkK` | ATA of (mint, team PDA); funded with 500 test USDC by `pnpm seed` |
| Owner | `FHMcsEbJ53Npt4VfXLBFq33wUmQZR8vFFXvFDzTqa875` | `Team.owner`. Key in `~/.config/rein/demo-owner.json` and Vercel (signs the public demo's approvals) |
| Research agent | authority `EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT`, spender `GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d` | Cap 5, 20 per hour, 10 payments per hour, 30 days; web-search, llm-inference, market-data, gpu-hour |
| Ada, operations | authority `EoGi1axnbXHvVYEX68cLHZPxxxY8W8zogywC2RtCjVhd`, spender `4odraK5F5vqPwFJy19uHr2Z2YSSfCXETPs2L8H5r9UxK` | Cap 25, 100 per week, all services |
| Sponsor (fee payer) | `hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF` | Pays every fee and payment-record rent. Topped up to 0.78 SOL on 2026-11-08 ([`61A8Fcz…`](https://explorer.solana.com/tx/61A8FczD5J4cvrgaEDzzogsimF1PeSEwttfxkjXAttjMV3UKe6jwx9QSDuoKew3x6hYZUxQB4s4KKEapKhuTsftz?cluster=devnet)). Each payment record costs about 0.003 SOL of rent |

## Claim pool (devnet, 2026-11-08)

`POST /api/claim` gives each Google account 0.30 test USDC, once ever, into the vault of the team its
embedded wallet owns: its $0.30 of AI compute. Two caps: the route's `CLAIM_TOTAL_CAP` (default 16
claims, about $5 of the 0G budget) and the pool's balance of 6 USDC (20 claims), which nothing tops
up: `pnpm pool:setup` mints only into a never-funded pool, and a drained pool stays drained unless
someone runs it with `--refill`.

| What | Value | Verified by |
|---|---|---|
| Pool authority | `5VMePooDsQpnkyRtekaGdnR2UHUcZ2eWboza5tt9mqaN` | Public key of `~/.config/rein/pool.json`, created by `scripts/pool-setup.ts` (mode 600, never in the repo). Holds no SOL; the sponsor pays each claim's fee. Production reads it from `REIN_POOL_SECRET` |
| Pool token account | `GTjreGPro3Dpg5rdn5EpqHA749yA6CK5uYPeTySxfwoZ` | ATA of (test USDC mint, pool authority). `spl-token display GTjre… -u devnet`: mint `Cwc241qD…`, owner `5VMePoo…`, initialized, no delegate, no close authority. Created in [`5fuDqPzW…`](https://explorer.solana.com/tx/5fuDqPzWL5iw8bHqNdPRTerW7XeNKN6DB8ANDKXyECKD51X1Ut491UvAMiuLNBh2aNmV3nJjzTnX595KN2dR25aG?cluster=devnet), rent paid by the CLI wallet |
| Funding | 6 test USDC | First funded with 50 by `mint_to` in [`4XPFwcWP…`](https://explorer.solana.com/tx/4XPFwcWP3giASuHHZy941zuPjtrqtRv6SMGeWoWG1ngGQgArXKrBQ6jZAgHawM32HE2RupN2AgTVVmNt3y4wijGR?cluster=devnet) under the earlier 0.10-a-day plan; one 0.10 test claim went to the demo vault ([`5jwjn5gW…`](https://explorer.solana.com/tx/5jwjn5gWnMRHAbRo4MzMvA9CysfnEg4r7KNKKnRadGpxCHCmcBY8Uc2ViF999be3X7sn15GdhAjx7rPr4BqJLnWU?cluster=devnet)); then 43.9 were burned by the pool key in [`5e9FjPZC…`](https://explorer.solana.com/tx/5e9FjPZCVZY8wbMiaN1Xsft4omqRsM3q3y5YnHdKYyKFae3umqJxgbnHENzMCF5EeNJfq665EjFGinBrMGXoPtY3?cluster=devnet), leaving 6. `spl-token balance --address GTjre… -u devnet` printed 6, and a re-run of the script printed "already funded, 20 claims left" and minted nothing |
| Claim amount | 300000 base units (0.30 test USDC), once per Privy user and once per wallet | `CLAIM_UNITS` in `web/lib/server/claim.ts` |

## Model

| What | Value | Verified by |
|---|---|---|
| Agent model | `openai/gpt-oss-120b` on Groq | `GET /openai/v1/models` with the project's key listed it; a tool-calling request returned `finish_reason: tool_calls` (agent lane, 2026-11-08) |

<!-- compute:start -->
## Compute gateway (devnet, written by `scripts/compute-setup.ts`)

| What | Value | Verified by |
|---|---|---|
| Gateway key | `HquphcsMCW2XWac5NhdfnqJJi1rv6gxwKew7gqvAJBDV` | Generated by the script into `~/.config/rein/gateway.json` (mode 600; production reads `REIN_GATEWAY_SECRET`). Never in the repo |
| Gateway test-USDC account | `EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5` | ATA of the gateway key for the config mint; `getAccount` checked owner = gateway key, mint = `Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14`. Every compute service pays it; refunds leave from it |
| `ai-chat` service (`["service", "ai-chat"]`) | `ANBMUJg453YEQM6dGWuZtkvFHRa9ina2dDT5wegBw9s8` | `register_service` tx [`46LZLaFk…`](https://explorer.solana.com/tx/46LZLaFksDTryRmjqwheDM62hd2h3cuzhABXmz5m5MEd6pBUzHQNhzho52Au3Ce1CrUo37TGrmABLnNkcEiXSbYS?cluster=devnet); `scripts/compute-setup.ts` fetched the account: payee token = the gateway token account, active, label "0G Chat (0GM-1.0-35B-A3B)", list price 0.01. Backed by 0G model `0GM-1.0-35B-A3B` |

Prices are not fixed: each quote asks 0G for the worst case of one run (live provider prices × 0G's USD rate) × 1.5, at least 0.01 test USDC. The list price above is only what the registry shows.
<!-- compute:end -->
