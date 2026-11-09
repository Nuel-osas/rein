---
description: Every address Rein uses on Solana devnet, with how it was verified.
---

# Devnet addresses

Every address below is on **Solana devnet**. Nothing here holds real money. The source of truth is `docs/CONSTANTS.md` in the repository.

## Program

| What | Address | Verified by |
|---|---|---|
| Program id | [`F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`](https://explorer.solana.com/address/F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe?cluster=devnet) | Deploy transaction [`2dGZ8Pw9…`](https://explorer.solana.com/tx/2dGZ8Pw9sq9mVJ1q5dJtYtwqWZxWF4cHqv76khz8Cc2VoyxzxvMhsTjA21vo58ax4Ud82hJQsS5nAgQiD1h9o3Ju?cluster=devnet). The deployed size matches the build of `programs/rein`, and the id equals the IDL and `declare_id!` |
| ProgramData | [`24HQcsdBhmhJAdEFk4H1bbCo9WXPyLxCL6ACRaf7usmF`](https://explorer.solana.com/address/24HQcsdBhmhJAdEFk4H1bbCo9WXPyLxCL6ACRaf7usmF?cluster=devnet) | `solana program show` |
| Upgrade authority | [`DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk`](https://explorer.solana.com/address/DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk?cluster=devnet) | The deployer's CLI wallet. Not a multisig: devnet only |

## Registry and token

| What | Address | Verified by |
|---|---|---|
| Config (`["config"]`) | [`9wir7aGbR6CHs1Ctf9o5uegvBbaBULZgsf2mbo7kodYF`](https://explorer.solana.com/address/9wir7aGbR6CHs1Ctf9o5uegvBbaBULZgsf2mbo7kodYF?cluster=devnet) | Derived from `["config"]`; written by `init_config` |
| Test USDC mint | [`Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14`](https://explorer.solana.com/address/Cwc241qD8qJiXDTgGZ2y6nLQg59cdkXzhCHz3vgFoa14?cluster=devnet) | `spl-token display`: 6 decimals. Not Circle USDC: a mint Rein controls so the demo can top itself up |
| Mint authority | [`9VUaEpHp4Bka2Yce6EtBxNGi5sb3pbd8SvkY75URQ2bx`](https://explorer.solana.com/address/9VUaEpHp4Bka2Yce6EtBxNGi5sb3pbd8SvkY75URQ2bx?cluster=devnet) | `spl-token display` |

## Services

Every service pays the compute gateway's test-USDC account [`EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5`](https://explorer.solana.com/address/EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5?cluster=devnet). Prices are quoted live per run; the list price is a label.

| Id | Account | State |
|---|---|---|
| `ai-chat` | [`ANBMUJg453YEQM6dGWuZtkvFHRa9ina2dDT5wegBw9s8`](https://explorer.solana.com/address/ANBMUJg453YEQM6dGWuZtkvFHRa9ina2dDT5wegBw9s8?cluster=devnet) | Active |
| `ai-image` | [`ACm5z2ZHktQpZufDQC1BgtCFRc1yTPpMWZ9qDvGvSacX`](https://explorer.solana.com/address/ACm5z2ZHktQpZufDQC1BgtCFRc1yTPpMWZ9qDvGvSacX?cluster=devnet) | Active |
| `ai-voice` | [`6iopRv9bPU5svbKcEw1N8ojdiLrBCb85CrK9geEokkTt`](https://explorer.solana.com/address/6iopRv9bPU5svbKcEw1N8ojdiLrBCb85CrK9geEokkTt?cluster=devnet) | Active |
| `ai-claude` | [`2iL1EsbsqRKD29F2wNubMjAtcSwZWsPcCKqmiy4WRzau`](https://explorer.solana.com/address/2iL1EsbsqRKD29F2wNubMjAtcSwZWsPcCKqmiy4WRzau?cluster=devnet) | Active |
| `ai-gpt` | [`G3C5WfPLqpkq6HKGpP5o5ujKJe2ub5LqtMowpYkCT3gD`](https://explorer.solana.com/address/G3C5WfPLqpkq6HKGpP5o5ujKJe2ub5LqtMowpYkCT3gD?cluster=devnet) | Active |
| `ai-video` | [`H5WPnSovaM6TyrAaDMQTe1f22jSyjBUpUiGMRm269Ky3`](https://explorer.solana.com/address/H5WPnSovaM6TyrAaDMQTe1f22jSyjBUpUiGMRm269Ky3?cluster=devnet) | Active |

Their registration transactions are in `docs/CONSTANTS.md` in the repository.

Suspended on 2026-11-09 (the first demo's placeholder services; history only, `pay` refuses them):

| Id | Account | List price |
|---|---|---|
| web-search | [`8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z`](https://explorer.solana.com/address/8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z?cluster=devnet) | 0.40 |
| llm-inference | [`DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p`](https://explorer.solana.com/address/DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p?cluster=devnet) | 2.00 |
| market-data | [`Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS`](https://explorer.solana.com/address/Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS?cluster=devnet) | 1.50 |
| gpu-hour | [`4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di`](https://explorer.solana.com/address/4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di?cluster=devnet) | 3.00 |
| premium-dataset | [`GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc`](https://explorer.solana.com/address/GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc?cluster=devnet) | 12.00 |

## Demo team

| What | Address | Notes |
|---|---|---|
| Team "Acme Research" | [`EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5`](https://explorer.solana.com/address/EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5?cluster=devnet) | Derived from `["team", owner]` |
| Vault | [`FdPTBxs2FcN4L5bHHUuXpDi2x6aYcnn5q7bpDisnaJkK`](https://explorer.solana.com/address/FdPTBxs2FcN4L5bHHUuXpDi2x6aYcnn5q7bpDisnaJkK?cluster=devnet) | Token account of (mint, team). Funded with 500 test USDC by the seed script |
| Owner | [`FHMcsEbJ53Npt4VfXLBFq33wUmQZR8vFFXvFDzTqa875`](https://explorer.solana.com/address/FHMcsEbJ53Npt4VfXLBFq33wUmQZR8vFFXvFDzTqa875?cluster=devnet) | Signs the public demo's approvals |
| Research agent | authority [`EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT`](https://explorer.solana.com/address/EYCrH75r2ELjg8LR2S3v4DLErGa5d3y7Lr7x5jhHEdhT?cluster=devnet), spender [`GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d`](https://explorer.solana.com/address/GbLisCamsrbfRC7NH85NGev2gcdARjPr7ZAVvwtp2J1d?cluster=devnet) | Cap 0.05, 0.50 per hour, 20 payments per hour, 30 days; `ai-chat`, `ai-image`, `ai-voice` (the change is recorded in `docs/CONSTANTS.md`) |
| Ada, operations | authority [`EoGi1axnbXHvVYEX68cLHZPxxxY8W8zogywC2RtCjVhd`](https://explorer.solana.com/address/EoGi1axnbXHvVYEX68cLHZPxxxY8W8zogywC2RtCjVhd?cluster=devnet), spender [`4odraK5F5vqPwFJy19uHr2Z2YSSfCXETPs2L8H5r9UxK`](https://explorer.solana.com/address/4odraK5F5vqPwFJy19uHr2Z2YSSfCXETPs2L8H5r9UxK?cluster=devnet) | Cap 25, 100 per week; her list still names the suspended placeholder services |
| Sponsor (fee payer) | [`hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF`](https://explorer.solana.com/address/hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF?cluster=devnet) | Pays every fee and payment-record rent, about 0.003 SOL per record |

## Model

| What | Value |
|---|---|
| Agent model | `openai/gpt-oss-120b` on Groq |
