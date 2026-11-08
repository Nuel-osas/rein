---
description: The claims, run on Solana devnet, each with its transaction.
---

# Evidence

Run on **Solana devnet** on 8 November 2026 at 03:40 UTC, against program [`F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`](https://explorer.solana.com/address/F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe?cluster=devnet).

The run used a throwaway team, [`7Gw1ANMy2qybMUoujc7FeRpkhYqTES8U1WaHdJHWW1vK`](https://explorer.solana.com/address/7Gw1ANMy2qybMUoujc7FeRpkhYqTES8U1WaHdJHWW1vK?cluster=devnet), and an agent, [`Dd6Qm6TmDtra1mvfcaUDvnZ2aTeBhqMFKBvMhp6SrUBJ`](https://explorer.solana.com/address/Dd6Qm6TmDtra1mvfcaUDvnZ2aTeBhqMFKBvMhp6SrUBJ?cluster=devnet), holding 0 SOL. The sponsor, [`hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF`](https://explorer.solana.com/address/hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF?cluster=devnet), paid the fees and rent. Amounts are test USDC.

| Claim | Result | Transaction |
|---|---|---|
| Agent with 0 SOL pays 0.40 USDC for web-search inside its policy | Paid | [4Ygd81XkNo…](https://explorer.solana.com/tx/4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6?cluster=devnet) |
| Agent asks for 9 USDC of GPU time, over its 5 USDC cap: filed for the owner | Pending (over cap) | [w1VEqKk3ic…](https://explorer.solana.com/tx/w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo?cluster=devnet) |
| Owner approves; the 9 USDC settles in the same transaction | Settled | [3PTN2Q5CYH…](https://explorer.solana.com/tx/3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa?cluster=devnet) |
| Prompt-injected agent tries a made-up service "wallet-9xqe" | Refused on chain: `AccountNotInitialized` | [5veVH6qrhh…](https://explorer.solana.com/tx/5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA?cluster=devnet) |
| Agent passes an attacker token account as the web-search payee | Refused on chain: `WrongPayee` | [4uZN8NEASQ…](https://explorer.solana.com/tx/4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr?cluster=devnet) |

## Run it again

From the repository root, with a funded devnet CLI wallet and a seeded cluster:

```bash
pnpm install
REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence
```

Every rule and stop is also covered by the program tests, against a local validator:

```bash
pnpm seed
REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules
```
