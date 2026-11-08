// The model calls, server side only. Anthropic through its official SDK; OpenAI through its
// Responses API over fetch (codex models are served there). COMPUTE_FAKE_UPSTREAM=1 replaces both
// with a deterministic text that says it is fake: the gateway never fakes silently.

import Anthropic from '@anthropic-ai/sdk';
import { sha256Hex, type UpstreamCall } from './core';

export const FAKE_PREFIX = '[FAKE UPSTREAM: no model was called; COMPUTE_FAKE_UPSTREAM=1]';

export function fakeText(service: string, model: string, prompt: string, maxTokens: number): string {
  return `${FAKE_PREFIX} ${service} would have asked ${model} (max ${maxTokens} tokens) about a ${Buffer.byteLength(prompt)}-byte prompt, sha256 ${sha256Hex(prompt).slice(0, 16)}.`;
}

async function anthropic(a: Parameters<UpstreamCall>[0]): Promise<string> {
  const client = new Anthropic({ apiKey: a.key!, timeout: 35_000, maxRetries: 0 });
  const res = await client.messages.create(
    {
      model: a.model,
      max_tokens: a.maxTokens,
      system: a.system,
      messages: [{ role: 'user', content: a.prompt }],
      ...(a.price.anthropicExtras ?? {}),
    } as Anthropic.MessageCreateParamsNonStreaming,
    { signal: a.signal },
  );
  if (res.stop_reason === 'refusal') throw new Error('the model declined the request');
  return res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

async function openai(a: Parameters<UpstreamCall>[0]): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${a.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: a.model, instructions: a.system, input: a.prompt, max_output_tokens: a.maxTokens, store: false }),
    signal: a.signal,
  });
  if (!res.ok) throw new Error(`OpenAI answered ${res.status}`);
  const body = (await res.json()) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  return (body.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .map((c) => (c.type === 'output_text' ? (c.text ?? '') : ''))
    .join('')
    .trim();
}

export function realUpstream(fake: boolean): UpstreamCall {
  return async (a) => {
    if (fake) return { text: fakeText(a.service, a.model, a.prompt, a.maxTokens), fake: true };
    if (!a.key) throw new Error(`${a.service} has no API key`);
    const text = a.service === 'claude-run' ? await anthropic(a) : await openai(a);
    return { text, fake: false };
  };
}
