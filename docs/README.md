# Documentation

Every document in this repository, what it answers, and which one wins when two disagree.

## Start here

| Document | Answers |
|---|---|
| [README.md](../README.md) | What Rein is, how to try it in 60 seconds, the proof table, the rules with their code |
| [llms.txt](../llms.txt) and [AGENTS.md](../AGENTS.md) | A compact map for AI readers: claims, proofs, layout, one-command checks |
| [SECURITY.md](../SECURITY.md) | Threat model, each guarantee with code and transaction, off-chain guards, keys, known gaps |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Branch, commit and PR conventions, checks before pushing, env var names |

## How it works

| Document | Answers |
|---|---|
| [DESIGN.md](DESIGN.md) | Architecture, data flow, state ownership, failure handling, decisions and rejected alternatives |
| [programs/rein/README.md](../programs/rein/README.md) | Instructions, accounts, PDA seeds, errors, constants |
| [web/README.md](../web/README.md) | Routes, server API routes, cached reads, env names |
| [agent/README.md](../agent/README.md) | Tools, scenarios, public API, CLI, tests |
| [zg-compute/README.md](../zg-compute/README.md) | The 0G Compute adapter, and how Rein uses it |
| [zg-compute/PROBE.md](../zg-compute/PROBE.md) | Live 0G probe results the adapter was built on |

## Proof

| Document | Answers |
|---|---|
| [CONSTANTS.md](CONSTANTS.md) | Every address the code and demo use, with how each was verified |
| [EVIDENCE.md](EVIDENCE.md) | The devnet transactions behind each claim, written by `pnpm evidence` |
| [deploy/devnet.json](../deploy/devnet.json) | The same public addresses as the scripts wrote them |

## History

| Document | Answers |
|---|---|
| [PROVENANCE.md](PROVENANCE.md) | Where the code came from, what was written for Solana, and the timeline |
| [SUBMISSION.md](SUBMISSION.md) | The MLH submission kit as prepared before submitting (its demo script and checklist are a record, not current state) |

## Site docs

The `/docs` pages of the live site are rendered from [web/content/docs](../web/content/docs/README.md).
They explain Rein to users; the documents above are the engineering record.

## Which document wins

1. The program source wins over any document about what the program does.
2. [CONSTANTS.md](CONSTANTS.md) wins over the code about addresses; a mismatch is a code bug.
3. [EVIDENCE.md](EVIDENCE.md) records what happened on chain at its timestamp.
4. Where a document and the code disagree on anything else, the code is current and the document is
   stale. Run `pnpm docs:check` to catch moved line references.
