import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {describe, expect, it} from "vitest";
import {ZgFailure} from "./failure";
import {fakeFetch, json} from "./test-helpers";
import {checkBinding, checkStoredSignature, sha256Hex, verifyWithRetries} from "./verify";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ZgFailure ? e.failure.code : "other";
  }
};

describe("verifyWithRetries", () => {
  it("delivers on the first true", async () => {
    expect(await verifyWithRetries(async () => true, {backoffMs: 0})).toEqual({attempts: 1});
  });

  it("retries while the signature is not published yet (null or a throw), then delivers", async () => {
    const answers: (boolean | null | Error)[] = [null, new Error("getting signature error"), true];
    let calls = 0;
    const out = await verifyWithRetries(
      async () => {
        const a = answers[calls++]!;
        if (a instanceof Error) throw a;
        return a;
      },
      {backoffMs: 0},
    );
    expect(out.attempts).toBe(3);
  });

  it("never retries a signature that recovers to someone else", async () => {
    let calls = 0;
    const p = verifyWithRetries(async () => {
      calls++;
      return false;
    }, {backoffMs: 0});
    expect(await code(p)).toBe("verification_rejected");
    expect(calls).toBe(1);
  });

  it("withholds the result when the check never completes", async () => {
    let calls = 0;
    const p = verifyWithRetries(async () => {
      calls++;
      return null;
    }, {attempts: 3, backoffMs: 0});
    expect(await code(p)).toBe("verification_unavailable");
    expect(calls).toBe(3);
  });
});

describe("checkStoredSignature and checkBinding", () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const provider = {url: "https://p.example", model: "m/1", signingAddress: signer.address};
  const request = "{\"prompt\":\"hi\"}";
  const response = "{\"text\":\"hello\"}";
  const text = `${sha256Hex(request)}:${sha256Hex(response)}`;

  const serve = (signed: {text: string; signature: string} | null) =>
    fakeFetch([["/v1/proxy/signature/", () => (signed ? json(signed) : new Response("", {status: 404}))]]);

  it("accepts EIP-191 by the provider's signer, from the documented endpoint", async () => {
    const f = serve({text, signature: await signer.signMessage({message: text})});
    const r = await checkStoredSignature(f, provider, "chat-1");
    expect(r.result).toBe(true);
    expect(f.calls[0]!.url).toBe("https://p.example/v1/proxy/signature/chat-1?model=m%2F1");
  });

  it("rejects a signature by anyone else", async () => {
    const f = serve({text, signature: await other.signMessage({message: text})});
    expect((await checkStoredSignature(f, provider, "chat-1")).result).toBe(false);
  });

  it("is null when nothing is stored yet or the body is malformed", async () => {
    expect((await checkStoredSignature(serve(null), provider, "c")).result).toBeNull();
    expect((await checkStoredSignature(serve({text, signature: "0xdead"}), provider, "c")).result).toBeNull();
  });

  it("binds the text to the exact request and delivered bytes", async () => {
    const f = serve({text, signature: await signer.signMessage({message: text})});
    expect(await checkBinding(f, provider, "c", {request: sha256Hex(request), response: sha256Hex(response)})).toEqual({request: true, response: true, text});
    const swapped = await checkBinding(f, provider, "c", {request: sha256Hex(request), response: sha256Hex("{\"text\":\"tampered\"}")});
    expect(swapped.response).toBe(false);
  });

  it("does not trust the text of a forged signature", async () => {
    const f = serve({text, signature: await other.signMessage({message: text})});
    expect(await checkBinding(f, provider, "c", {request: null, response: sha256Hex(response)})).toEqual({request: null, response: null, text});
  });
});
