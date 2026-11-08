---
description: What Rein does not do yet, and what has not been tested.
---

# Still open

Rein was built for a hackathon. This is what it does not do yet.

{% hint style="warning" %}
Devnet only, test USDC only. The program has not been independently audited.
{% endhint %}

* **Devnet only.** Mainnet would use Circle USDC and hand the program's upgrade key to a multisig. Today the upgrade authority is the deployer's CLI wallet, [`DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk`](https://explorer.solana.com/address/DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk?cluster=devnet).
* **Payment records are never closed,** so their rent is not reclaimed. Each costs the sponsor about 0.003 SOL.
* **Period rollover is not covered by a test.** The shortest period is 60 seconds.
* **The sponsor's rate limits live in memory,** per server instance. A determined visitor could still spend its devnet SOL.
* **The registry is admin-controlled.** One key decides which services exist and who they pay.
* **No independent audit.** The program has 13 tests covering every rule and stop, and the claims in [Evidence](../resources/evidence.md) were run on devnet. Nobody outside the team has reviewed it.
