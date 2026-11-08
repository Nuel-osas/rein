import { randomBytes } from 'node:crypto';

/** Matches `check_intent` in the program: 1 to 32 characters of a-z, A-Z, 0-9, - and _. */
export const INTENT_MAX = 32;
export const INTENT_RE = /^[A-Za-z0-9_-]{1,32}$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function isValidIntent(intent: string): boolean {
  return INTENT_RE.test(intent) && Buffer.byteLength(intent) <= INTENT_MAX;
}

/**
 * A fresh payment intent: `<prefix>-<time base36>-<12 random chars>`, 24 characters with the
 * default prefix. The payment record's address is derived from it, so an intent is used once.
 * 64 symbols divide 256 evenly, so `byte & 63` keeps the random part uniform (72 bits).
 */
export function makeIntent(
  prefix = 'ag',
  now: number = Date.now(),
  random: (n: number) => Uint8Array = randomBytes,
): string {
  if (!/^[A-Za-z0-9]{0,8}$/.test(prefix)) throw new Error(`bad intent prefix: ${prefix}`);
  const bytes = random(12);
  let tail = '';
  for (const b of bytes) tail += ALPHABET[b & 63];
  const intent = [prefix, Math.floor(now).toString(36), tail].filter(Boolean).join('-');
  if (!isValidIntent(intent)) throw new Error(`generated an invalid intent: ${intent}`);
  return intent;
}
