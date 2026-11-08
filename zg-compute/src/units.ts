/*
 * 0G amounts. Everything that moves or prices 0G is a bigint of neuron (10^18 neuron = 1 0G).
 * The one float in this package is the USD rate, and it is applied only to produce a display
 * number, never to an amount that is sent.
 */

export const NEURON_PER_ZG = 10n ** 18n;

/** Whole 0G to neuron. Integers only: the SDK's deposit calls take whole 0G here. */
export const zgToNeuron = (zg: number | bigint): bigint => {
  if (typeof zg === "bigint") return zg * NEURON_PER_ZG;
  if (!Number.isInteger(zg) || zg < 0) throw new Error("zgToNeuron takes a non-negative whole number of 0G");
  return BigInt(zg) * NEURON_PER_ZG;
};

/** The smallest whole number of 0G that is at least `neuron`. */
export const ceilToWholeZg = (neuron: bigint): bigint => (neuron <= 0n ? 0n : (neuron + NEURON_PER_ZG - 1n) / NEURON_PER_ZG);

/** "1.050000" style, for logs and revision strings. Truncates, never rounds up. */
export function formatZg(neuron: bigint, decimals = 6): string {
  const negative = neuron < 0n;
  const abs = negative ? -neuron : neuron;
  const whole = abs / NEURON_PER_ZG;
  const frac = (abs % NEURON_PER_ZG).toString().padStart(18, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${whole}${decimals > 0 ? `.${frac}` : ""}`;
}

/** Neuron to a float of 0G, for display only. */
export const neuronToZgNumber = (neuron: bigint): number => Number(neuron) / 1e18;

/** a × num / den, rounded up. For margins and safety factors on neuron amounts. */
export const mulDivCeil = (a: bigint, num: bigint, den: bigint): bigint => (a * num + den - 1n) / den;

export const maxBig = (...xs: bigint[]): bigint => xs.reduce((m, x) => (x > m ? x : m));
