---
description: Every error the Rein program returns, in the order it declares them.
---

# Program errors

Anchor numbers custom errors from 6000, in the order the program declares them.

| Code | Name | Message | Returned by |
|---|---|---|---|
| 6000 | `TeamPaused` | the team is paused | `pay`, `approve` |
| 6001 | `NotActive` | spender is not active | `pay`, and changes to a revoked spender |
| 6002 | `Expired` | spender policy has expired | `pay` |
| 6003 | `ServiceSuspended` | the service is suspended | `pay` |
| 6004 | `WrongPayee` | the payee is not the one the registry names | `pay`, `approve` |
| 6005 | `NotPending` | payment is not pending | `approve`, `decline`, `cancel` |
| 6006 | `RequestExpired` | the pending payment has expired | `approve`, after the 24-hour deadline |
| 6007 | `NotOwnerOrFiler` | only the owner or the filer can cancel | `cancel` |
| 6008 | `AlreadySpender` | already a spender: change its policy instead | `add_spender` on an active or paused spender |
| 6009 | `KindChanged` | a spender keeps its kind | `add_spender` re-granting a revoked spender as the other kind |
| 6010 | `ZeroAmount` | amount must be above zero | `pay`, `withdraw` |
| 6011 | `MemoTooLong` | a memo is at most 64 bytes | `pay` |
| 6012 | `BadIntent` | an intent is 1 to 32 characters of a-z, A-Z, 0-9, - and _ | `pay` |
| 6013 | `BadServiceId` | a service id is 1 to 32 characters of a-z, 0-9 and - | `register_service` |
| 6014 | `BadLabel` | a label is 1 to 32 characters | `create_team`, `add_spender`, `register_service` |
| 6015 | `BadPolicy` | allowance and cap above zero, cap within allowance, period at least 60 s, at least 1 payment, expiry in the future | `add_spender`, `set_policy` |
| 6016 | `TooManyServices` | at most 8 services per spender | `add_spender`, `set_services` |

## Not from Rein

| Error | When |
|---|---|
| `AccountNotInitialized` (Anchor 3012) | A service id that is not in the registry: there is no account to load, so the transaction fails before Rein's code runs |
| `ConstraintSeeds`, `ConstraintHasOne` and other Anchor constraint errors | An account that is not the one the instruction expects, such as a signer who is not the team's owner |

Refused at approval is not an error. `approve` succeeds and closes the payment with status **Refused**, so the refusal is recorded on chain.
