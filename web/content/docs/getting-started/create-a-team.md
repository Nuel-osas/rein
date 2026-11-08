---
description: One transaction creates the team account and its vault, and your wallet owns both.
---

# Create a team

## What a team is

A team is an account the Rein program owns, at the address derived from `["team", owner]`. That means one wallet owns at most one team, and anyone can work out a team's address from its owner. The team records its owner, its token, its vault, its name, whether it is paused, and running totals: how many spenders and payments it has, and how much has been paid.

## Create one

1. Sign in with Google.
2. If your wallet owns no team, Rein opens **Create your team**. You can also open it from the team list.
3. Enter a **Team name** of 1 to 32 characters.
4. Confirm. One `create_team` transaction creates the team and its vault. The sponsor pays the fee and the rent.

Your wallet is now the owner. Only the owner can add or change spenders, approve or decline payments, pause the team and withdraw from the vault.

## Next

* [Add test USDC](add-test-usdc.md) to the vault.
* [Add a spender](../using-rein/spenders-and-policies.md), a person or an agent.
