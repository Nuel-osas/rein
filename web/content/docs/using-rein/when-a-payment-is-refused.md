---
description: What each refusal means and what to do about it.
---

# When a payment is refused

A payment can end up three ways other than paid. They are different, and Rein shows them differently.

## Pending is not refused

A Pending payment went over a limit and is waiting for the owner. Nothing failed and no money moved. The owner can approve it for 24 hours. See [Approvals](approvals.md).

## Refused when sent

The transaction fails and nothing is recorded. The most common reasons:

| Message | What to do |
|---|---|
| the team is paused | The owner resumes the team under **Settings** |
| spender is not active | The owner resumes the spender, or grants a revoked one again |
| spender policy has expired | The owner edits the policy with a new expiry |
| the service is suspended | Choose another service, or wait for the registry to reactivate it |
| the payee is not the one the registry names | Something passed a payee other than the registry's. The program refused it. Nothing moved |
| an intent is 1 to 32 characters of a-z, A-Z, 0-9, - and _ | Use a valid intent. The app and the agent make one for you |
| a memo is at most 64 bytes | Shorten the memo |

A service id that is not in the registry has no account to load, so the transaction fails before the program runs (Anchor's `AccountNotInitialized`). The full list is in [Program errors](../reference/program-errors.md).

## Refused at approval

The owner approved, but a stop applied by then: the spender was paused, revoked or re-granted, the policy expired, the service was suspended or its payee changed. The payment is closed as **Refused** and can never settle. If the spend is still wanted, the spender files a new payment under its current policy.

## When the result is unknown

If the app or the agent cannot confirm what happened to a transaction, it reports it as pending, with its signature, and says not to retry until it has been checked. Retrying with the same intent is safe anyway: the payment record can only be created once.
