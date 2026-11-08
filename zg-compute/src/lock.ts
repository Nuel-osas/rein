/*
 * One queue per 0G wallet for the whole process.
 *
 * Every write the adapter makes (create or top up the ledger, move funds to a provider, acknowledge
 * a provider) is a transaction from the same wallet, and each is decided on a balance read just
 * before it. Two runs deciding at once would both see the same balance and both top up, or collide
 * on the wallet's nonce. So the read and the write happen as one step, one at a time, per wallet.
 *
 * In-process only. The gateway runs as one process; a second instance against the same wallet
 * would need a shared lock.
 */

const queues = new Map<string, Promise<unknown>>();

export function withWalletLock<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
  const key = wallet.toLowerCase();
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  // Drop the entry once this was the last thing queued, so the map does not grow per wallet.
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}
