---
description: Where every payee comes from, and why a spender cannot choose one.
---

# The service registry

## What it is

The registry is a set of on-chain accounts, one per service, at `["service", id]`. Each records the service's id, its label, the payee, the payee's token account, a list price and whether it is active. Only the registry admin set in the config account can register a service or suspend it.

A service id is 1 to 32 characters of `a-z`, `0-9` and `-`.

## On devnet

Every service Rein sells is a real AI run on 0G mainnet, run by Rein's compute gateway and paid to the gateway's test-USDC account [`EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5`](https://explorer.solana.com/address/EY2bqDLkJdWx71ywHBfMAGzAf1a6PefFYUmfpCmz5AX5?cluster=devnet). The price of a run is quoted live (0G's worst case x 1.5, at least 0.01 test USDC); the registry's list price is only a label.

| Id | What one run gets | Trust | State |
|---|---|---|---|
| `ai-chat` ([`ANBMUJg4…`](https://explorer.solana.com/address/ANBMUJg453YEQM6dGWuZtkvFHRa9ina2dDT5wegBw9s8?cluster=devnet)) | One answer from 0GM-1.0-35B-A3B | TEE verified | Live |
| `ai-image` ([`ACm5z2ZH…`](https://explorer.solana.com/address/ACm5z2ZHktQpZufDQC1BgtCFRc1yTPpMWZ9qDvGvSacX?cluster=devnet)) | One 1024x1024 image from a prompt (z-image-turbo) | TEE verified | Live |
| `ai-voice` ([`6iopRv9b…`](https://explorer.solana.com/address/6iopRv9bPU5svbKcEw1N8ojdiLrBCb85CrK9geEokkTt?cluster=devnet)) | A transcript of up to 60 seconds of audio (Whisper large v3) | TEE verified | Live |
| `ai-claude` ([`2iL1Esbs…`](https://explorer.solana.com/address/2iL1EsbsqRKD29F2wNubMjAtcSwZWsPcCKqmiy4WRzau?cluster=devnet)) | One answer from Claude (Claude Haiku 5.5 by default) | Relayed through the 0G Router, no TEE | Live |
| `ai-gpt` ([`G3C5WfPL…`](https://explorer.solana.com/address/G3C5WfPLqpkq6HKGpP5o5ujKJe2ub5LqtMowpYkCT3gD?cluster=devnet)) | One answer from GPT (GPT-5.6 Luna by default) | Relayed through the 0G Router, no TEE | Live |
| `ai-video` ([`H5WPnSov…`](https://explorer.solana.com/address/H5WPnSovaM6TyrAaDMQTe1f22jSyjBUpUiGMRm269Ky3?cluster=devnet)) | One 4 second, 480p clip from a prompt (Seedance 2.0 Fast) | Relayed through the 0G Router, no TEE | Live |

The registration transactions of the five newer services are in `docs/CONSTANTS.md` in the repository. A server without a 0G Private Computer key still prices the three relayed services, shows them as needing that key, and refunds a paid run in full; it never makes up an answer.

### Suspended: the first demo's placeholder services

The first seed registered five demonstration services whose payees were fresh devnet keypairs with nothing behind them. They were suspended with `set_service_active(false)` on 2026-11-09, so `pay` refuses them outright (`ServiceSuspended`) and a Pending payment to one of them can no longer be approved. They stay on chain as history:

| Id | Account | List price (test USDC) |
|---|---|---|
| web-search | [`8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z`](https://explorer.solana.com/address/8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z?cluster=devnet) | 0.40 |
| llm-inference | [`DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p`](https://explorer.solana.com/address/DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p?cluster=devnet) | 2.00 |
| market-data | [`Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS`](https://explorer.solana.com/address/Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS?cluster=devnet) | 1.50 |
| gpu-hour | [`4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di`](https://explorer.solana.com/address/4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di?cluster=devnet) | 3.00 |
| premium-dataset | [`GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc`](https://explorer.solana.com/address/GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc?cluster=devnet) | 12.00 |

## Why a spender cannot choose the payee

`pay` takes the service account, not an address. Its payee token account must be exactly the one the service names, or the program refuses with `WrongPayee`. So:

* An agent told to pay an attacker's wallet has no way to pass that wallet. Its tools take a service id.
* A made-up service id, like `wallet-9xqe`, has no registry account. The transaction fails on chain with `AccountNotInitialized`.
* Passing an attacker's token account as the payee of a real service fails with `WrongPayee`.

Both refusals were run on devnet. The transactions are in [Evidence](../resources/evidence.md).

## When the registry changes

A Pending payment records the payee the registry named when it was filed. If the registry names a different payee by the time the owner approves, or the service has been suspended, the approval refuses the payment for good instead of paying the new payee.
