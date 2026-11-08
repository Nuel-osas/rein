// JSON that keeps bigints: money is bigint end to end, so a value crossing the network as JSON is
// tagged {"$bigint":"123"} and restored on the other side, never turned into a lossy number.

export function toWire(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v));
}

export function fromWire<T>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$bigint === 'string' && /^-?\d+$/.test(v.$bigint)
      ? BigInt(v.$bigint)
      : v,
  ) as T;
}
