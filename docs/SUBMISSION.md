# Submission kit: MLH Solana Hackathon

Form: https://www.mlh.com/events/solana-hackathon/submissions/new
Initial submission due Sun Nov 8, 10:00 AM ET (16:00 WAT). Final 11:45 AM ET (17:45 WAT). The form says 1:00 PM EST; we aim for the earliest.

Copy below is plain text for the form: no em dashes, no asterisks, no hashes.

## Name

Rein

## One-line pitch (short_description)

Spending rules for teams and their AI agents, enforced by a Solana program. Over budget, the money waits for your tap.

## Description

AI agents can now pay for things. Giving one a wallet means trusting a prompt with your money. Rein puts the rules on chain instead.

A team shares one USDC vault owned by a program address. Every person and every agent pays under a policy the program enforces: an allowance per period, a cap per payment, a payment count, an expiry, and a list of allowed services. Inside the policy, a payment settles in the same transaction. Over a limit, it does not fail: it is filed as a pending payment, and one tap on Approve settles it in under a second.

What makes it Solana and not a web2 app with a chain attached:
1. An agent is a keypair with no money and no SOL. A sponsor is the fee payer, so spenders never touch SOL.
2. Pay takes a registered service, never an address. The payee must match the on-chain service registry, so a prompt-injected agent cannot name a wallet.
3. Each payment record's address is derived from the spender and its intent, so a retry can never pay twice.
4. An approval waives a budget, never a stop: if the spender was revoked or the service suspended, approval refuses for good.

Try it without a wallet: open the demo team, run the agent, watch it overspend, then press Approve.

Built in the hackathon window: the Anchor program, 13 tests, a Next.js console, and a Groq-hosted agent whose tools have no address parameter. Every claim has a devnet transaction link in docs/EVIDENCE.md.

## Technologies

Solana, Anchor 0.31, Rust, SPL Token, Solana devnet, @coral-xyz/anchor, @solana/web3.js, Solana Wallet Adapter, TypeScript, Next.js, React, Groq API (openai/gpt-oss-120b), Vercel

## Links

| Field | Value |
|---|---|
| GitHub | https://github.com/Nuel-osas/rein (private by choice; judges rely on the live app, video and on-chain evidence) |
| Live demo | https://rein-navy.vercel.app/demo |
| Demo video | VIDEO_URL |
| extra_links: Demo team, no wallet needed | https://rein-navy.vercel.app/app/EWuQEKAj3hmQJxBvPJ7PWYM38xcCqhivYao9afEy6Bg5 |
| extra_links: Agent with 0 SOL pays inside its policy (devnet tx) | https://explorer.solana.com/tx/4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6?cluster=devnet |
| extra_links: Over-cap payment approved, settles in one tx (devnet tx) | https://explorer.solana.com/tx/3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa?cluster=devnet |
| extra_links: Prompt-injected payment refused on chain (devnet tx) | https://explorer.solana.com/tx/5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA?cluster=devnet |
| extra_links: Program on Solana Explorer | https://explorer.solana.com/address/F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe?cluster=devnet |

## AI coding tools (ai_tools)

claude-code, coding:anthropic/claude-opus-5.5

## Prize categories (sponsor_usage answers)

| Category | Enter? | Answer |
|---|---|---|
| Top 3 Overall | yes (automatic) | The program is the product: vaults owned by PDAs, policies as program accounts, a separate fee payer so agents hold no SOL, payment records seeded by intent so retries cannot double pay, and sub-second approvals that settle in one transaction. |
| AI Track Top Prize | yes | The AI plans and buys what a task needs; Solana decides whether the money moves. The agent's tools are list_services, check_budget and pay, and none takes an address, so a prompt injection cannot name a wallet. Over its cap, its payment waits on chain for the owner. |
| DeFi Track Top Prize | yes | Rein is programmable treasury control for USDC: a shared vault with per-spender allowances, caps, counts and expiry, approvals that settle atomically, and a registry so funds can only reach listed payees. Anyone can fund a team vault, since it is a plain SPL token account. |
| Best Beginner Hack | no | Not beginners. |
| Gaming Track Top Prize | no | Not a game. |

## 60-second demo script

This is the script of the video recorded for the submission on 2026-11-08 (https://youtu.be/ut9FW1qgL8A).
The demo used placeholder registry services then (a search API, inference credits and a 12 dollar
dataset); they were never real offerings and are suspended on devnet since 2026-11-09. The live
demo now buys only real 0G runs: Research brief buys ai-chat, Over the limit asks for ai-claude
(not on the agent's list, so it waits for Approve), Prompt injection is unchanged. See "Try it in
60 seconds" in the README.

| Time | On screen | Voice |
|---|---|---|
| 0 to 6 s | Landing hero, the gate drawing | AI agents can pay now. Giving one a wallet means trusting a prompt with your money. |
| 6 to 14 s | Demo team: vault 500 USDC, the Research agent's policy card (cap 5, 20 a day) | Rein puts the rules in a Solana program. This agent can spend 5 dollars a payment, 20 a day. |
| 14 to 24 s | Agent panel: run "research". It checks budget, pays web search and inference. Two receipts appear | Inside its policy it pays at once. It holds no SOL; a sponsor pays the fees. |
| 24 to 36 s | Run "overspend": it asks for the 12 dollar dataset. Approvals shows it pending: over cap, not an allowed service | Over its limits it does not fail. The payment waits on chain for the owner. |
| 36 to 44 s | Press Approve. Status flips to settled, vault drops by 12, explorer link | One tap, one transaction, under a second. |
| 44 to 54 s | Run "injection": the task says send 50 USDC to a wallet. The agent tries a fake service, refused, explorer shows the failed tx | And a prompt injection cannot name a wallet. Pay only takes registered services. |
| 54 to 60 s | Logo, URL | Rein. Your agents spend on a rein. |

## Checklist

- [x] Devnet deploy, seed, `pnpm evidence` written to docs/EVIDENCE.md (placeholder-era evidence, kept as history)
- [x] Web app on Vercel with env vars, demo team loads cold
- [x] Agent runs from the live site (overspend filed 12 USDC, approve settled it, vault 500 to 488; placeholder-era run, services since suspended)
- [x] README links filled
- [ ] Demo video recorded and uploaded
- [x] Repo visibility: stays private (user decision)
- [ ] Submitted by 16:00 WAT; project link recorded here
