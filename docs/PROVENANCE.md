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

## What was written for Solana, during the hackathon

- The Anchor program in `programs/rein`. It is new Rust written for Solana, not a translation of
  Bursar's NEAR contracts. The Solana-specific design is in the README ("Why it needs Solana"):
  PDA-owned vaults, Spender accounts, a separate fee payer, Payment records seeded by intent, and the
  on-chain service registry.
- The data layer of the web app, the sponsor relay and the demo actions.
- The AI agent in `agent/`.
- The first commit is dated 2026-11-08. The hackathon ran from 2026-11-06 12:00 ET to 2026-11-08 11:45 ET.

## Third-party code

Anchor, the Solana web3.js and SPL Token libraries, and the Solana wallet adapter, under their own
licenses. Listed in each `package.json` and `Cargo.toml`.
