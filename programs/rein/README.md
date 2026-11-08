# programs/rein

The Rein Anchor program (Anchor 0.31.1, one file: [src/lib.rs](src/lib.rs)). A team keeps test USDC
in a vault owned by its PDA. Every person and agent pays under a policy this program enforces.
`pay` takes a registered service, never an address. Inside the policy a payment settles in the same
transaction; over a limit it is filed as Pending and only the owner can approve it. An approval
waives a budget, never a stop.

| | |
|---|---|
| Program id (devnet) | `F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe`, `declare_id!` at [src/lib.rs#L12](src/lib.rs#L12) |
| IDL | [idl/rein.json](../../idl/rein.json) (copied byte for byte to [web/lib/idl/rein.json](../../web/lib/idl/rein.json)), types in [idl/rein.ts](../../idl/rein.ts) |
| Deploy, ProgramData, upgrade authority, registry and demo accounts | [docs/CONSTANTS.md](../../docs/CONSTANTS.md) |
| Devnet transactions for each claim | [docs/EVIDENCE.md](../../docs/EVIDENCE.md) |

## Instructions

Amounts are token base units (6 decimals). Times are unix seconds. "payer" is the fee and rent
payer, normally the sponsor, so spenders never hold SOL.

| Instruction | Signers | What it does | Key checks | Code |
|---|---|---|---|---|
| `init_config` | admin (pays rent) | Creates the one `Config`: admin and the token teams hold | `["config"]` can be created once | [L36](src/lib.rs#L36) |
| `register_service(id, label, price)` | admin | Lists a `Service`; `payee_token` and its owner are recorded. `price` is a list price, not a limit | `has_one = admin`; payee token holds `config.mint`; id 1 to 32 of `a-z 0-9 -`; label 1 to 32 bytes | [L46](src/lib.rs#L46) |
| `set_service_active(active)` | admin | Suspends or restores a service | `has_one = admin` | [L67](src/lib.rs#L67) |
| `create_team(name)` | payer, owner | Creates the `Team` PDA and its vault (ATA of mint and team PDA) | mint must equal `config.mint`; name 1 to 32 bytes | [L74](src/lib.rs#L74) |
| `set_paused(paused)` | owner | Pauses or resumes the whole team | team PDA of the signer, `has_one = owner` | [L91](src/lib.rs#L91) |
| `withdraw(amount)` | owner | Moves vault funds to any token account of the team's mint | `amount > 0`; `has_one = owner, vault`; `to` holds `team.mint` | [L97](src/lib.rs#L97) |
| `add_spender(authority, kind, label, policy, services)` | payer, owner | Grants a person or agent a policy. Re-granting a revoked spender bumps its generation | `check_policy`; at most 8 services (deduplicated); `AlreadySpender` unless revoked; `KindChanged` | [L113](src/lib.rs#L113) |
| `set_policy(policy)` | owner | Replaces the policy | not revoked; `check_policy` | [L150](src/lib.rs#L150) |
| `set_services(services)` | owner | Replaces the allowed service list | not revoked; at most 8 | [L158](src/lib.rs#L158) |
| `set_spender_status(active)` | owner | Pauses or resumes a spender | not revoked | [L167](src/lib.rs#L167) |
| `revoke` | owner | Revokes a spender. Final for that generation | owner's team | [L174](src/lib.rs#L174) |
| `pay(intent, amount, memo)` | payer, authority (the spender key) | Pays a registered service from the vault, or files a Pending payment with reason bits | team not paused; spender Active; before `expires_at`; service active; payee token equals the registry's ([L695](src/lib.rs#L695)); Payment PDA from (spender, intent) can be created once ([L701](src/lib.rs#L701)); intent 1 to 32 of `A-Z a-z 0-9 - _`; memo at most 64 bytes; `amount > 0` | [L186](src/lib.rs#L186) |
| `approve` | owner | Settles a Pending payment in the same transaction, or marks it Refused if a stop applies now | team not paused; Pending; before `deadline`; stops: spender not Active, generation changed, policy expired, service suspended, service payee moved ([L257](src/lib.rs#L257)) | [L246](src/lib.rs#L246) |
| `decline` | owner | Declines a Pending payment | Pending | [L287](src/lib.rs#L287) |
| `cancel` | owner or the filing authority | Withdraws a Pending payment | signer is `team.owner` or `payment.authority`; Pending | [L296](src/lib.rs#L296) |

Helpers: `transfer_from_vault` signs with the team PDA seeds ([L313](src/lib.rs#L313));
`check_policy` ([L367](src/lib.rs#L367)); `clean_services` ([L376](src/lib.rs#L376)); `roll`
moves the period forward on schedule from the grant, never to "now" ([L389](src/lib.rs#L389));
`over_limits` returns the reason bits ([L400](src/lib.rs#L400)).

A paused team makes `approve` fail with `TeamPaused`, which leaves the payment Pending (not
Refused). An approved payment counts against the period even past the limits (saturating add).

## PDA seeds

| Account | Seeds | Code |
|---|---|---|
| `Config` | `["config"]` | [L555](src/lib.rs#L555) |
| `Service` | `["service", id]` | [L572](src/lib.rs#L572) |
| `Team` | `["team", owner]` | [L603](src/lib.rs#L603) |
| Vault | associated token account of (mint, team PDA), not a program PDA | [L610](src/lib.rs#L610) |
| `Spender` | `["spender", team, authority]` | [L650](src/lib.rs#L650) |
| `Payment` | `["payment", spender, intent]` | [L701](src/lib.rs#L701) |

## Accounts

| Account | Key fields | Code |
|---|---|---|
| `Config` | `admin`, `mint`, `services` (count) | [L462](src/lib.rs#L462) |
| `Service` | `id`, `label`, `payee`, `payee_token`, `price`, `active` | [L471](src/lib.rs#L471) |
| `Team` | `owner`, `mint`, `vault`, `name`, `paused`, `spenders`, `payments`, `paid_count`, `paid_total`, `created_at` | [L485](src/lib.rs#L485) |
| `Spender` | `team`, `authority`, `kind` (Person, Agent), `label`, `status` (Active, Paused, Revoked), `generation`, `policy`, `services` (max 8), `period_start`, `spent`, `count`, `added_at` | [L502](src/lib.rs#L502) |
| `Payment` | `team`, `spender`, `authority`, `kind`, `service`, `payee_token` (fixed at filing), `amount`, `intent`, `memo`, `generation`, `reasons`, `status`, `created_at`, `deadline`, `decided_at`, `number` | [L522](src/lib.rs#L522) |
| `Policy` (struct) | `allowance`, `period_secs`, `cap`, `max_payments`, `expires_at` | [L448](src/lib.rs#L448) |

Payment status ([L433](src/lib.rs#L433)): `Paid` (inside the policy, settled when filed),
`Pending`, `Settled` (approved), `Declined`, `Cancelled`, `Refused` (a stop applied at approval,
final). Payment accounts are never closed, so their rent is not reclaimed.

## Constants and reason bits

| Name | Value | Code |
|---|---|---|
| `MAX_SERVICES` | 8 | [L14](src/lib.rs#L14) |
| `LABEL_MAX` | 32 | [L15](src/lib.rs#L15) |
| `MEMO_MAX` | 64 | [L16](src/lib.rs#L16) |
| `INTENT_MAX` | 32 | [L17](src/lib.rs#L17) |
| `SERVICE_ID_MAX` | 32 | [L18](src/lib.rs#L18) |
| `MIN_PERIOD_SECS` | 60 | [L19](src/lib.rs#L19) |
| `PENDING_TTL_SECS` | 86400 (a Pending payment can be approved for one day) | [L21](src/lib.rs#L21) |
| `OVER_SERVICE` | 1: service not in the spender's list | [L24](src/lib.rs#L24) |
| `OVER_CAP` | 2: amount above `cap` | [L25](src/lib.rs#L25) |
| `OVER_ALLOWANCE` | 4: `spent + amount` above `allowance` | [L26](src/lib.rs#L26) |
| `OVER_COUNT` | 8: `count` already at `max_payments` | [L27](src/lib.rs#L27) |

## Errors

Codes match [idl/rein.json](../../idl/rein.json). Enum at [src/lib.rs#L753](src/lib.rs#L753).

| Code | Name | Message |
|---|---|---|
| 6000 | `TeamPaused` | the team is paused |
| 6001 | `NotActive` | spender is not active |
| 6002 | `Expired` | spender policy has expired |
| 6003 | `ServiceSuspended` | the service is suspended |
| 6004 | `WrongPayee` | the payee is not the one the registry names |
| 6005 | `NotPending` | payment is not pending |
| 6006 | `RequestExpired` | the pending payment has expired |
| 6007 | `NotOwnerOrFiler` | only the owner or the filer can cancel |
| 6008 | `AlreadySpender` | already a spender: change its policy instead |
| 6009 | `KindChanged` | a spender keeps its kind |
| 6010 | `ZeroAmount` | amount must be above zero |
| 6011 | `MemoTooLong` | a memo is at most 64 bytes |
| 6012 | `BadIntent` | an intent is 1 to 32 characters of a-z, A-Z, 0-9, - and _ |
| 6013 | `BadServiceId` | a service id is 1 to 32 characters of a-z, 0-9 and - |
| 6014 | `BadLabel` | a label is 1 to 32 characters |
| 6015 | `BadPolicy` | allowance and cap above zero, cap within allowance, period at least 60 s, at least 1 payment, expiry in the future |
| 6016 | `TooManyServices` | at most 8 services per spender |

An unknown service id has no `Service` account, so `pay` fails with Anchor's
`AccountNotInitialized` before any of these run (devnet proof in
[docs/EVIDENCE.md](../../docs/EVIDENCE.md)).

## Build and test

- Build with the Anchor 0.31 CLI from the repo root (`anchor build`). The IDL in `idl/` is
  committed so the web app and agent build without Anchor.
- Tests: 13 tests in [tests/rein.ts](../../tests/rein.ts), run against a local validator seeded with
  `pnpm seed` ([scripts/seed.ts](../../scripts/seed.ts)):

  ```bash
  REIN_RPC_URL=http://127.0.0.1:8999 pnpm test:rules
  ```

  Last run 2026-11-08 against a seeded local validator. Not re-run for this document.
- Devnet evidence: `REIN_CLUSTER=devnet REIN_RPC_URL=https://api.devnet.solana.com pnpm evidence`
  ([scripts/evidence.ts](../../scripts/evidence.ts)) writes [docs/EVIDENCE.md](../../docs/EVIDENCE.md).
