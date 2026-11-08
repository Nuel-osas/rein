import {describe, expect, it} from "vitest";
import {readCapped} from "./http";

/** A body that never ends, counting how many 1 KB chunks were pulled from it. */
function endless() {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {res: new Response(body), pulled: () => pulled, cancelled: () => cancelled};
}

describe("readCapped", () => {
  it("reads a body up to the cap", async () => {
    expect([...(await readCapped(new Response(new Uint8Array([1, 2, 3])), 3))]).toEqual([1, 2, 3]);
  });

  it("stops a body that runs on past the cap, and cancels it, instead of buffering it", async () => {
    const e = endless();
    await expect(readCapped(e.res, 10 * 1024)).rejects.toThrow(/cap/);
    expect(e.pulled()).toBeLessThan(20);
    expect(e.cancelled()).toBe(true);
  });

  it("refuses a declared length over the cap before reading", async () => {
    const e = endless();
    const res = new Response(e.res.body, {headers: {"content-length": String(1 << 30)}});
    await expect(readCapped(res, 1024)).rejects.toThrow(/declared/);
    expect(e.pulled()).toBeLessThan(3);
  });
});
