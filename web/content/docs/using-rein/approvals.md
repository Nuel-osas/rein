---
description: Over a limit, a payment waits on chain for the owner. An approval waives a budget, never a stop.
---

# Approvals

## How a payment gets here

When a payment breaks one or more of the spender's limits, `pay` does not revert. It files a payment record with status **Pending** and records every reason as a bit:

| Reason | Meaning |
|---|---|
| Over service | The service is not in the spender's list |
| Over cap | The amount is above the cap per payment |
| Over allowance | It would take the spender past its allowance for the period |
| Over count | The spender has used all its payments for the period |

No money moves. The payment appears under **Approvals** for the owner.

## Deciding

| Action | Who | What happens |
|---|---|---|
| Approve | Owner | If no stop applies, the payment settles in the same transaction and counts against the spender's period |
| Decline | Owner | The payment is closed as Declined. No money moves |
| Cancel | Owner, or the spender who filed it | The payment is closed as Cancelled. No money moves |

A Pending payment can be approved for 24 hours after it is filed. After that its deadline has passed and `approve` refuses it.

## An approval never overrides a stop

The owner's approval waives a budget. It does not waive a stop. At approval time the program checks again, and refuses the payment for good (status **Refused**) if:

* the spender is paused or revoked
* the spender was revoked and granted again since the payment was filed (a new generation)
* the policy has expired
* the service is suspended
* the registry now names a different payee for the service than when the payment was filed

A paused team refuses the approval transaction outright.

## On the demo team

Anyone can approve or decline the demo team's Pending payments, without signing in. The server signs as the demo owner, after checking on chain that the payment exists, belongs to the demo team and is Pending. See [Try the live demo](../getting-started/try-the-live-demo.md).
