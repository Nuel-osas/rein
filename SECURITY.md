# Security

Rein runs on **Solana devnet** with a test token. Nothing here holds real money except the small
0G mainnet wallet that pays for compute runs. This file says what is guaranteed, by which line of
code, with which transaction as evidence, and what is not guaranteed yet.

## Reporting a problem

Open a private report to the maintainers through GitHub (the repository's Security tab, "Report a
vulnerability") or contact the repository owner, [Nuel-osas](https://github.com/Nuel-osas), directly.
Please do not open a public issue for anything that could drain a vault, the sponsor, the claim
pool or the 0G wallet. Include the route or instruction, the input, and a transaction signature if
you have one.

## Threat model

| Actor | What they can do | What stops them |
|---|---|---|
| A prompt-injected or buggy agent | Call its tools with any arguments | No tool takes an address; the program pays only the registry payee and only under the agent's policy |
| A spender key that leaks | Sign `pay` as that spender | The policy caps the damage per payment and per period; the owner can pause or revoke it |
| Anyone on the internet | Call every API route | Each route checks input against chain, verifies Privy tokens where it acts for a user, rate-limits, and fails closed |
| A client lying about a payment | Send a payment address or amount to the compute gateway | The gateway derives the `Payment` address itself and reads it from chain |
| A double request or retry | Race two claims, two runs or two refunds | Postgres unique indexes, Redis `SET NX` locks, and the (spender, intent) `Payment` PDA |
| An operator mistake | Misconfigure an env var | Missing or malformed configuration refuses; it never falls back to a permissive default |

Out of scope today: a compromised program upgrade authority (it is the deployer, see Known gaps),
a compromised Vercel account, and Solana or 0G network failures.

## On-chain guarantees

All in [programs/rein/src/lib.rs](programs/rein/src/lib.rs). Evidence transactions are on devnet
and listed in [docs/EVIDENCE.md](docs/EVIDENCE.md).

| Guarantee | Enforced at | Evidence |
|---|---|---|
| Only the program moves vault funds; the vault's authority is the team PDA | [lib.rs#L607-L613](programs/rein/src/lib.rs#L607-L613), [lib.rs#L320](programs/rein/src/lib.rs#L320) | every settled payment below |
| A spender holds no SOL; the sponsor is a separate fee payer | [lib.rs#L676-L678](programs/rein/src/lib.rs#L676-L678) | [`4Ygd81Xk…`](https://explorer.solana.com/tx/4Ygd81XkNoDzwUxJoNXKrdPT9PHpyPdKikM6uNsN2Tj49ScGCxricxwVqRNb7w4DXcLen2TACfbtWZ38psdTM6K6?cluster=devnet) (agent with 0 SOL pays) |
| Over a limit, a payment is filed, not paid | [lib.rs#L400-L415](programs/rein/src/lib.rs#L400-L415), [lib.rs#L236-L240](programs/rein/src/lib.rs#L236-L240) | [`w1VEqKk3…`](https://explorer.solana.com/tx/w1VEqKk3icLuuBUgreeyafsHFQyyiXy9MuJVHETjr6edEnLSkWNjCchvfbJs3MBtm6CJUPgVTprC1ZZNAKoBDbo?cluster=devnet) |
| Only the owner approves, and approval settles in the same transaction | [lib.rs#L716](programs/rein/src/lib.rs#L716), [lib.rs#L269-L282](programs/rein/src/lib.rs#L269-L282) | [`3PTN2Q5C…`](https://explorer.solana.com/tx/3PTN2Q5CYHv8NGjfr4FvwX9GG8QSxbq8JvdC9Z4XiwNNY6LYTRptxniY7ETC1PBQ47jJREQ1L6Wxvfes7tLqvHNa?cluster=devnet) |
| An unknown service cannot be paid: it has no registry account | [lib.rs#L690](programs/rein/src/lib.rs#L690) | [`5veVH6qr…`](https://explorer.solana.com/tx/5veVH6qrhhjEyZdTyPAsZuDa9RDkNg6ozBedGnDAduxqtZ9WQ4AWsNxRrHQxbtEYeaM52734tcR8HwkbmwPRr1fA?cluster=devnet) (`AccountNotInitialized`) |
| Only the registry's payee can be paid | [lib.rs#L695](programs/rein/src/lib.rs#L695), [lib.rs#L726](programs/rein/src/lib.rs#L726) | [`4uZN8NEA…`](https://explorer.solana.com/tx/4uZN8NEASQZjW1HyqTPHxaZQ7QfQjL5WeHC94Za8imDnJzpHbzQ2DgD4CNR3uNb4cVCqqhhuzmG9b8znkNo9uZnr?cluster=devnet) (`WrongPayee`) |
| An intent is paid or filed at most once | [lib.rs#L701](programs/rein/src/lib.rs#L701) | test "pays an intent at most once", [tests/rein.ts#L182](tests/rein.ts#L182) |
| An approval waives a budget, never a stop | [lib.rs#L257-L266](programs/rein/src/lib.rs#L257-L266) | test at [tests/rein.ts#L245](tests/rein.ts#L245) |
| Paused team, paused or revoked spender, expiry, suspended service refuse | [lib.rs#L195-L198](programs/rein/src/lib.rs#L195-L198) | test at [tests/rein.ts#L275](tests/rein.ts#L275) |
| Only the owner withdraws | [lib.rs#L629](programs/rein/src/lib.rs#L629) | test at [tests/rein.ts#L300](tests/rein.ts#L300) |
| A paused team cannot approve (the payment stays Pending, not Refused) | [lib.rs#L252](programs/rein/src/lib.rs#L252) | not separately tested |

## Off-chain guards

| Guard | What it does | Code |
|---|---|---|
| Sponsor: fee payer only | Refuses unless the sponsor is the fee payer; 1 to 6 instructions; at most 4096 bytes of request and 1232 of transaction | [web/app/api/sponsor/route.ts#L73-L84](web/app/api/sponsor/route.ts#L73-L84) |
| Sponsor: Rein instructions only | Only the 12 user instructions in `ALLOWED`, compute-budget limit and price (capped), and one create-if-missing of the signer's own test-USDC account | [route.ts#L24-L42](web/app/api/sponsor/route.ts#L24-L42), [route.ts#L89-L117](web/app/api/sponsor/route.ts#L89-L117) |
| Sponsor: where its key may sit | Only account 0 (`payer`) of `pay`, `create_team`, `add_spender`; never as authority or owner | [route.ts#L119-L122](web/app/api/sponsor/route.ts#L119-L122) |
| Sponsor: signatures | Every other required signature must be present and valid before it sends | [route.ts#L127-L128](web/app/api/sponsor/route.ts#L127-L128) |
| Claim: who | A verified Privy token, and the team must be the PDA of one of that user's Privy Solana wallets | [web/app/api/claim/route.ts#L37-L48](web/app/api/claim/route.ts#L37-L48) |
| Claim: once per account | Postgres unique indexes per user and per wallet (excluding failed), Redis `SET NX` race locks, a total cap (`CLAIM_TOTAL_CAP`, default 16) and the pool balance (6 test USDC at setup) as a hard cap | [web/lib/server/claim.ts#L41-L42](web/lib/server/claim.ts#L41-L42), [claim.ts#L185-L187](web/lib/server/claim.ts#L185-L187), [claim.ts#L222-L223](web/lib/server/claim.ts#L222-L223) |
| Claim: never twice | The signature is recorded before broadcast; an unknown outcome stays pending under it | [claim.ts#L1-L11](web/lib/server/claim.ts#L1-L11) |
| Compute: verify before run | The `Payment` PDA is derived from the quoted spender and intent, must be owned by the program, Paid or Settled, and match team, spender, service, payee and amount | [web/lib/server/compute/core.ts#L569-L586](web/lib/server/compute/core.ts#L569-L586) |
| Compute: refund once | The refund record with its signature is written with `SET NX` before broadcast; a preflight refusal is left for an operator, never auto-resent | [web/lib/server/compute/wire.ts#L60-L99](web/lib/server/compute/wire.ts#L60-L99) |
| Compute: cost guards | Daily server budget, 20 runs per team per day, 0G ledger floor, one run per team at a time | [core.ts#L367-L393](web/lib/server/compute/core.ts#L367-L393), [core.ts#L612-L614](web/lib/server/compute/core.ts#L612-L614) |
| Compute: kill switch | `COMPUTE_ENABLED=false` or the Redis key `compute:halt` stops new runs; paid runs are refunded | [core.ts#L324-L327](web/lib/server/compute/core.ts#L324-L327), [core.ts#L589](web/lib/server/compute/core.ts#L589) |
| Compute: no fake in production | The labelled fake backend is forced off when `NODE_ENV=production` | [core.ts#L174](web/lib/server/compute/core.ts#L174) |
| Faucet | Mints only into the demo team's vault; any other team is refused | [web/app/api/faucet/route.ts#L33-L34](web/app/api/faucet/route.ts#L33-L34) |
| Demo actions | Approve or decline only a Pending payment that belongs to the demo team, checked on chain first | [web/app/api/demo/route.ts#L66](web/app/api/demo/route.ts#L66) |
| Agent route | Without a team, the demo team runs; with a team, a verified Privy user whose wallet owns it | [web/lib/server/team-agent.ts#L20-L39](web/lib/server/team-agent.ts#L20-L39) |
| Store fails closed | In production a missing `REDIS_URL` returns no store and the route answers 503; no in-memory fallback | [web/lib/server/store.ts#L106-L108](web/lib/server/store.ts#L106-L108), [store.ts#L142-L143](web/lib/server/store.ts#L142-L143) |
| Rate limits | Per IP, or per Privy user where signed in, on every API route | [web/lib/server/limit.ts](web/lib/server/limit.ts) |

## Key handling

Names and locations only. No key is in the repository.

| Key | Production | Local | Role |
|---|---|---|---|
| Sponsor | `REIN_SPONSOR_SECRET` | `~/.config/rein/sponsor.json` | Fee payer and payment-record rent |
| Demo owner | `REIN_DEMO_OWNER_SECRET` | `~/.config/rein/demo-owner.json` | Signs the public demo's approvals |
| Demo agent | `REIN_DEMO_AGENT_SECRET` | `~/.config/rein/demo-agent.json` | The demo team's agent spender |
| Mint authority | `REIN_MINT_AUTHORITY_SECRET` | `~/.config/rein/mint-authority.json` | Test USDC mint (demo reset, faucet) |
| Claim pool | `REIN_POOL_SECRET` | `~/.config/rein/pool.json` | Owns the pool token account |
| Compute gateway | `REIN_GATEWAY_SECRET` | `~/.config/rein/gateway.json` | Owns the gateway token account, signs refunds |
| Team agents | `REIN_AGENT_SEED` | none | HMAC seed; each team's agent key is derived, never stored |
| Intents | `GATEWAY_SECRET` (at least 32 characters) | none | HMAC key for compute intents |
| 0G wallet | `ZG_PRIVATE_KEY` | env var only (the operator's copy is kept outside the repo, see [CONSTANTS](docs/CONSTANTS.md)) | Pays 0G mainnet providers |
| 0G Router | `ZG_ROUTER_API_KEY` | none | Optional 0G Private Computer key |
| Program admin and upgrade | Solana CLI wallet | `~/.config/solana/id.json` | Registry admin and upgrade authority |

Loader: [web/lib/server/keys.ts#L10-L19](web/lib/server/keys.ts#L10-L19). Key files are read only
outside production unless `REIN_ALLOW_KEY_FILES=1` ([keys.ts#L43](web/lib/server/keys.ts#L43)).
A malformed key is treated as missing and the route refuses.

## Known gaps

| Gap | Why it matters | Plan |
|---|---|---|
| Devnet only, test token | No real money is protected yet | Mainnet would use Circle USDC |
| The upgrade authority is the deployer's CLI wallet (`DBk7Bu7t…`) | Whoever holds it can replace the program | Hand to a multisig or remove before mainnet |
| Payment rent is not reclaimed | Each record costs the sponsor about 0.003 SOL | Add a close instruction for decided payments |
| Rate limits are per server instance, in memory | A determined caller across instances gets more than the limit | Move limits to Redis |
| Period rollover is untested | `roll` is simple but unproven by a test (the shortest period is 60 s) | Add a test with a 60 s period |
| No independent audit | Bugs may exist | Audit before mainnet |
| Approving while the team is paused fails instead of refusing | The payment stays Pending until it expires | Documented behaviour |
| The signed-in flow has not been run end to end by a person after the last deploy | A regression may exist there | The team is checking it |
