# Evidence (devnet, 2026-11-08T03:40:06.698Z)

Program `F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`. Throwaway team `7Gw1ANMy2qybMUoujc7FeRpkhYqTES8U1WaHdJHWW1vK`. Agent `Dd6Qm6TmDtra1mvfcaUDvnZ2aTeBhqMFKBvMhp6SrUBJ` (0 SOL; the sponsor `hEczh4E1DGuGPTikSLGZKZUAxSAF7Cw1vaSNrxatfjF` pays fees and rent).

| Claim | Result | Transaction |
|---|---|---|
| Agent with 0 SOL pays 0.40 USDC for web-search inside its policy | paid | [4Ygd81XkNo…](https://explorer.solana.com/tx/4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6?cluster=devnet) |
| Agent asks for 9 USDC of GPU time, over its 5 USDC cap: filed for the owner | pending (over_cap) | [w1VEqKk3ic…](https://explorer.solana.com/tx/w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo?cluster=devnet) |
| Owner approves; the 9 USDC settles in the same transaction | settled | [3PTN2Q5CYH…](https://explorer.solana.com/tx/3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa?cluster=devnet) |
| Prompt-injected agent tries a made-up service "wallet-9xqe" | refused on chain: AccountNotInitialized | [5veVH6qrhh…](https://explorer.solana.com/tx/5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA?cluster=devnet) |
| Agent passes an attacker token account as the web-search payee | refused on chain: WrongPayee | [4uZN8NEASQ…](https://explorer.solana.com/tx/4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr?cluster=devnet) |

Re-run: `REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence`
