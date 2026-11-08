/** A small client for Groq's OpenAI-compatible chat completions, with tool calling. */

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/**
 * OpenAI's open-weight 120B mixture-of-experts, the largest model this Groq key lists (Nov 2026:
 * gpt-oss-120b, gpt-oss-20b, qwen3.8-27b, plus non-chat models). It answered a real tool-calling
 * request with finish_reason "tool_calls" and called check_budget before pay as instructed, and it
 * ran all three demo scenarios end to end on localnet. Override with REIN_AGENT_MODEL.
 */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AssistantReply {
  content: string | null;
  reasoning: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export class GroqError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
  /** Retries for rate limits, server errors, network errors and malformed tool calls. */
  retries?: number;
}

export async function chat(o: ChatOptions): Promise<AssistantReply> {
  const retries = o.retries ?? 3;
  let lastError: Error = new Error('no attempt made');
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        signal: o.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model,
          messages: o.messages,
          tools: o.tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          temperature: o.temperature ?? 0.2,
        }),
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      lastError = e as Error;
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (res.ok && body?.choices?.[0]?.message) {
      const choice = body.choices[0];
      const m = choice.message;
      return {
        content: typeof m.content === 'string' && m.content.trim() ? m.content : null,
        reasoning: typeof m.reasoning === 'string' && m.reasoning.trim() ? m.reasoning : null,
        toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : [],
        finishReason: choice.finish_reason ?? null,
      };
    }
    // Never echo the request; it carries the key in a header only, but keep errors short anyway.
    const message: string = body?.error?.message ?? `HTTP ${res.status}`;
    lastError = new GroqError(res.status, message.slice(0, 500));
    const malformedToolCall = res.status === 400 && body?.error?.code === 'tool_use_failed';
    const retryable = res.status === 429 || res.status >= 500 || malformedToolCall;
    if (!retryable) throw lastError;
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 20) * 1000 : 700 * 2 ** attempt);
  }
  throw lastError;
}
