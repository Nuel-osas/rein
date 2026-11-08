---
description: Where every payee comes from, and why a spender cannot choose one.
---

# The service registry

## What it is

The registry is a set of on-chain accounts, one per service, at `["service", id]`. Each records the service's id, its label, the payee, the payee's token account, a list price and whether it is active. Only the registry admin set in the config account can register a service or suspend it.

A service id is 1 to 32 characters of `a-z`, `0-9` and `-`.

## On devnet

| Id | Account | List price (test USDC) |
|---|---|---|
| web-search | [`8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z`](https://explorer.solana.com/address/8uLAhqCCWRF4JqT9GgnUQvLozRCp3JKcQo5gJfwPsj1Z?cluster=devnet) | 0.40 |
| llm-inference | [`DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p`](https://explorer.solana.com/address/DEj1rr9Q3zBuNcC9FeFeWi6BZrHMxq34G4AqDYSnHg7p?cluster=devnet) | 2.00 |
| market-data | [`Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS`](https://explorer.solana.com/address/Hft9fRxre32TCa9T8nooDPhqBxJNnfsGurwzdBBQAQRS?cluster=devnet) | 1.50 |
| gpu-hour | [`4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di`](https://explorer.solana.com/address/4RwFfvF93w5aFB4S56UhiUdF2b91ZugP9p9ENdQxS4Di?cluster=devnet) | 3.00 |
| premium-dataset | [`GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc`](https://explorer.solana.com/address/GvMw9LZqdgQyhkfybT6mp6XgSRRGAgSLKxZnTp8AfXNc?cluster=devnet) | 12.00 |

These are demonstration services registered by the seed script. Each payee is a fresh devnet keypair; nothing behind them sells a real product.

## Why a spender cannot choose the payee

`pay` takes the service account, not an address. Its payee token account must be exactly the one the service names, or the program refuses with `WrongPayee`. So:

* An agent told to pay an attacker's wallet has no way to pass that wallet. Its tools take a service id.
* A made-up service id, like `wallet-9xqe`, has no registry account. The transaction fails on chain with `AccountNotInitialized`.
* Passing an attacker's token account as the payee of a real service fails with `WrongPayee`.

Both refusals were run on devnet. The transactions are in [Evidence](../resources/evidence.md).

## When the registry changes

A Pending payment records the payee the registry named when it was filed. If the registry names a different payee by the time the owner approves, or the service has been suspended, the approval refuses the payment for good instead of paying the new payee.
