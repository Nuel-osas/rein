# Provenance

## What this is based on

Rein is the Solana version of **Bursar**, our NEAR build of spending rules for teams and their AI
agents. Bursar is a rebuild of **Nuntio** (https://nuntio.finance) by Sele Odigie / 71Labs, made with
its author's agreement, and led by Ruru (Veltri Labs).

## What was carried over

- **The product idea and its rules:**
  - every spender, person or agent, pays under a policy the program enforces
  - `pay` takes a service, never an address
  - over a limit, the owner decides
  - an approval waives a budget, never a stop
  - a failed read is unknown, never zero
- **The web app's screens, components and visual design**, adapted from Nuntio's web app
  (`71Labs/nuntio`, `apps/web`) with its author's agreement. Names, logos and copy are Rein's, and
  everything behind the screens (wallet, chain reads, transactions, server routes) is new Solana code.
- **The 0G Compute adapter** in [zg-compute/](../zg-compute/README.md), ported from Nuntio's
  `packages/zg-compute` (`@nuntio/zg-compute`) with its author's agreement, as `@rein/zg-compute`
  (commit `9d223c2`). It keeps Nuntio's pins, tests (186 passing) and probe notes. Changes: the parts
  of `@nuntio/commerce` it needs are copied into `zg-compute/src/commerce`, the Monad x402 operation
  and its test are dropped, and the 0G SDK loads through its CommonJS build. Rein's own gateway
  around it (`web/lib/server/compute/`: Solana payment checks, pricing markup, refunds, the Router
  backend) is new code.

## What was written for Solana, during the hackathon

- The Anchor program in `programs/rein`. It is new Rust written for Solana, not a translation of
  Bursar's NEAR contracts. The Solana-specific design is in the README ("Why it needs Solana"):
  PDA-owned vaults, Spender accounts, a separate fee payer, Payment records seeded by intent, and the
  on-chain service registry.
- The data layer of the web app, the sponsor relay and the demo actions.
- The AI agent in `agent/`.
- The claim pool and the Solana side of the compute gateway.

## Timeline

Times are from `git log` (WAT, UTC+1) and the team's submission record.

| When | What |
|---|---|
| 2026-11-06 12:00 ET | Hackathon opened, per the event page |
| 2026-11-08 03:10 WAT | First commit (`afd778c`) |
| 2026-11-08 04:42 to 15:38 WAT | PRs #1 to #9 merged: program, tests, agent, console, sign-in, Nuntio's screens and routes |
| 2026-11-08 16:02 WAT | Submitted to the MLH Solana Hackathon; `main` was at `c0f4d5d` |
| 2026-11-08 17:07 WAT | Prize category entries made |
| 2026-11-08 18:00 UTC (19:00 WAT) | Event ended |
| 2026-11-08 19:41 to 22:39 WAT | After the event: PRs #10 to #16, the 0G compute gateway, the claim pool, the 0G constants, the Vault page removal, the strip-down, cached reads, the Get started checklist and tour |

The README's [Hackathon timeline](../README.md#hackathon-timeline) lists each merge.

## Third-party code

Anchor, the Solana web3.js and SPL Token libraries, and the Solana wallet adapter, under their own
licenses. Listed in each `package.json` and `Cargo.toml`.
