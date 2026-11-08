/*
 * Claude's 0G providers take Anthropic's Messages API only (POST {endpoint}/messages): sent an
 * OpenAI chat body they answer 400 "not available on the openai API format (supported: [anthropic])"
 * (the paid probe of 30 Oct). Everything else speaks OpenAI chat, so this file translates
 * at the edge, both ways:
 *
 * - toAnthropicBody: an OpenAI chat body (as the gateway built and cleaned it) to a Messages body.
 *   System and developer messages become `system`; assistant tool calls become `tool_use` blocks and
 *   tool messages `tool_result` blocks; neighbouring messages of one role are merged (the API wants
 *   turns to alternate); OpenAI tools and tool_choice map to Anthropic's. Parameters Claude's
 *   providers do not list (temperature, top_p, penalties, seed, logprobs, logit_bias) are left out,
 *   and a request that needs one Claude cannot honour (a JSON response format, a legacy
 *   function_call, a tool that is not a function) is refused with a problem, before any 0G moves.
 * - fromAnthropicMessage: a Messages answer to an OpenAI chat completion.
 * - anthropicStreamToOpenAi: a Messages event stream to OpenAI chunks, ending with a usage chunk
 *   and `data: [DONE]`. An `error` event, or a stream that ends before `message_stop`, errors the
 *   stream, so the reader treats it as an answer cut short (charged by what was used), never a
 *   finished one.
 *
 * Usage: prompt tokens are input + cache writes + cache reads (the gateway never asks for caching, so the
 * last two are zero; counted at the full input price if a relay reports them), completion tokens
 * are output tokens.
 */

import {closedModel} from "./commerce/index";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

export interface AnthropicProblem {
  problem: string;
  param: string | null;
}

/** Text of an OpenAI message content: a string, or the text parts of a list joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Json => isObject(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** Anthropic content blocks for a user turn: text parts kept as text blocks. */
function userBlocks(content: unknown): Json[] {
  if (typeof content === "string") return content ? [{type: "text", text: content}] : [];
  if (!Array.isArray(content)) return [];
  return content.filter((p): p is Json => isObject(p) && p.type === "text" && typeof p.text === "string" && p.text !== "").map((p) => ({type: "text", text: p.text}));
}

const DROPPED = ["temperature", "top_p", "presence_penalty", "frequency_penalty", "seed", "logprobs", "top_logprobs", "logit_bias", "stream_options", "chat_template_kwargs", "n"];

/** An OpenAI chat body to an Anthropic Messages body for `model`, or why Claude cannot take it. */
export function toAnthropicBody(openai: Json, model: string): {body: Json} | AnthropicProblem {
  const messages = Array.isArray(openai.messages) ? openai.messages : [];
  const system: string[] = [];
  const turns: {role: "user" | "assistant"; content: Json[]}[] = [];
  const push = (role: "user" | "assistant", blocks: Json[]) => {
    if (blocks.length === 0) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else turns.push({role, content: [...blocks]});
  };

  for (const [i, m] of messages.entries()) {
    if (!isObject(m)) return {problem: `Message ${i} is not an object.`, param: `messages[${i}]`};
    const role = m.role;
    if (role === "system" || role === "developer") {
      const t = textOf(m.content);
      if (t) system.push(t);
      continue;
    }
    if (role === "user") {
      push("user", userBlocks(m.content));
      continue;
    }
    if (role === "assistant") {
      if (m.function_call !== undefined && m.function_call !== null) return {problem: "Claude takes tool_calls, not the older function_call.", param: `messages[${i}].function_call`};
      const blocks: Json[] = [];
      const t = textOf(m.content);
      if (t) blocks.push({type: "text", text: t});
      if (Array.isArray(m.tool_calls)) {
        for (const [j, c] of m.tool_calls.entries()) {
          const fn = isObject(c) && isObject(c.function) ? c.function : null;
          if (!isObject(c) || typeof c.id !== "string" || !fn || typeof fn.name !== "string") {
            return {problem: `Tool call ${j} of message ${i} needs an id and a function name.`, param: `messages[${i}].tool_calls[${j}]`};
          }
          let input: unknown = {};
          const args = typeof fn.arguments === "string" ? fn.arguments : "";
          if (args.trim()) {
            try {
              input = JSON.parse(args);
            } catch {
              return {problem: `Tool call ${j} of message ${i} has arguments that are not JSON.`, param: `messages[${i}].tool_calls[${j}].function.arguments`};
            }
          }
          if (!isObject(input)) return {problem: `Tool call ${j} of message ${i} must have a JSON object as its arguments.`, param: `messages[${i}].tool_calls[${j}].function.arguments`};
          blocks.push({type: "tool_use", id: c.id, name: fn.name, input});
        }
      }
      push("assistant", blocks);
      continue;
    }
    if (role === "tool") {
      if (typeof m.tool_call_id !== "string" || !m.tool_call_id) return {problem: `Message ${i} is a tool result with no tool_call_id.`, param: `messages[${i}].tool_call_id`};
      push("user", [{type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content)}]);
      continue;
    }
    return {problem: `Claude takes system, user, assistant and tool messages; message ${i} is "${String(role)}".`, param: `messages[${i}].role`};
  }
  if (turns.length === 0) return {problem: "Send at least one user message.", param: "messages"};

  const body: Json = {model, max_tokens: openai.max_tokens, messages: turns};
  // A model that would spend a small max_tokens thinking and write nothing is asked not to think.
  if (closedModel(model)?.thinkingOff) body.thinking = {type: "disabled"};
  if (system.length > 0) body.system = system.join("\n\n");
  if (openai.stream === true) body.stream = true;

  const stop = openai.stop;
  if (typeof stop === "string" && stop) body.stop_sequences = [stop];
  else if (Array.isArray(stop) && stop.length > 0) body.stop_sequences = stop;

  const format = openai.response_format;
  if (isObject(format) && format.type !== undefined && format.type !== "text") {
    return {problem: "Claude here does not take response_format; ask for JSON in the prompt instead.", param: "response_format"};
  }

  if (Array.isArray(openai.tools) && openai.tools.length > 0) {
    const tools: Json[] = [];
    for (const [i, t] of openai.tools.entries()) {
      const fn = isObject(t) && t.type === "function" && isObject(t.function) ? t.function : null;
      if (!fn || typeof fn.name !== "string") return {problem: `Tool ${i} must be a function with a name.`, param: `tools[${i}]`};
      tools.push({
        name: fn.name,
        ...(typeof fn.description === "string" ? {description: fn.description} : {}),
        input_schema: isObject(fn.parameters) ? fn.parameters : {type: "object", properties: {}},
      });
    }
    body.tools = tools;
    let choice: Json | null = null;
    const c = openai.tool_choice;
    if (c === "auto" || c === undefined || c === null) choice = {type: "auto"};
    else if (c === "none") choice = {type: "none"};
    else if (c === "required") choice = {type: "any"};
    else if (isObject(c) && c.type === "function" && isObject(c.function) && typeof c.function.name === "string") choice = {type: "tool", name: c.function.name};
    else return {problem: 'tool_choice must be "auto", "none", "required" or a named function.', param: "tool_choice"};
    if (openai.parallel_tool_calls === false && choice.type !== "none") choice.disable_parallel_tool_use = true;
    body.tool_choice = choice;
  }

  for (const k of DROPPED) delete body[k];
  return {body};
}

const FINISH: Record<string, string> = {end_turn: "stop", stop_sequence: "stop", max_tokens: "length", tool_use: "tool_calls", refusal: "content_filter", pause_turn: "stop"};
const finishOf = (reason: unknown) => (typeof reason === "string" ? (FINISH[reason] ?? "stop") : null);

/** Anthropic usage to OpenAI usage. */
export function usageOf(u: unknown): {prompt_tokens: number; completion_tokens: number; total_tokens: number} | null {
  if (!isObject(u)) return null;
  const prompt = count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens);
  const completion = count(u.output_tokens);
  return {prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion};
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** An Anthropic Messages answer to an OpenAI chat completion. Throws when it is not one. */
export function fromAnthropicMessage(msg: unknown, model: string): Json {
  if (!isObject(msg) || !Array.isArray(msg.content)) throw new Error("the answer is not an Anthropic message");
  let text = "";
  const toolCalls: Json[] = [];
  for (const b of msg.content) {
    if (!isObject(b)) continue;
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      toolCalls.push({id: b.id, type: "function", function: {name: b.name, arguments: JSON.stringify(b.input ?? {})}});
    }
  }
  const message: Json = {role: "assistant", content: text || (toolCalls.length > 0 ? null : "")};
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  const out: Json = {
    id: typeof msg.id === "string" ? msg.id : "msg",
    object: "chat.completion",
    created: nowSeconds(),
    model,
    choices: [{index: 0, message, finish_reason: finishOf(msg.stop_reason) ?? "stop"}],
  };
  const usage = usageOf(msg.usage);
  if (usage) out.usage = usage;
  return out;
}

/** Splits an event stream into each event's `data` (joined lines); ignores `event:` and comments. */
class EventSplitter {
  private buf = "";
  private dec = new TextDecoder();
  push(bytes: Uint8Array): string[] {
    this.buf += this.dec.decode(bytes, {stream: true}).replace(/\r\n/g, "\n");
    const out: string[] = [];
    let at: number;
    while ((at = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, at);
      this.buf = this.buf.slice(at + 2);
      const data = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) out.push(data);
    }
    return out;
  }
  /** The last event, when the stream ended without the blank line after it. */
  end(): string[] {
    this.buf += this.dec.decode();
    if (!this.buf.trim()) {
      this.buf = "";
      return [];
    }
    this.buf += "\n\n";
    return this.push(new Uint8Array());
  }
}

/**
 * An Anthropic Messages event stream to an OpenAI chat chunk stream: a role chunk, content and
 * tool-call deltas, a finish chunk, a usage chunk with no choices, then `data: [DONE]`.
 */
export function anthropicStreamToOpenAi(source: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const split = new EventSplitter();
  const reader = source.getReader();
  let id = "msg";
  const created = nowSeconds();
  let input = {input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0};
  let output = 0;
  let stopped = false;
  /** Anthropic content block index → OpenAI tool call index. */
  const tools = new Map<number, number>();
  const chunk = (choices: Json[], extra: Json = {}) => enc.encode(`data: ${JSON.stringify({id, object: "chat.completion.chunk", created, model, choices, ...extra})}\n\n`);
  const delta = (d: Json, finish: string | null = null) => chunk([{index: 0, delta: d, finish_reason: finish}]);

  const translate = (data: string): Uint8Array[] => {
    let e: unknown;
    try {
      e = JSON.parse(data);
    } catch {
      throw new Error("the provider sent an event that is not JSON");
    }
    if (!isObject(e)) return [];
    switch (e.type) {
      case "message_start": {
        const m = isObject(e.message) ? e.message : {};
        if (typeof m.id === "string") id = m.id;
        const u = isObject(m.usage) ? m.usage : {};
        input = {input_tokens: count(u.input_tokens), cache_creation_input_tokens: count(u.cache_creation_input_tokens), cache_read_input_tokens: count(u.cache_read_input_tokens)};
        output = count(u.output_tokens);
        return [delta({role: "assistant", content: ""})];
      }
      case "content_block_start": {
        const b = isObject(e.content_block) ? e.content_block : {};
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && typeof e.index === "number") {
          const n = tools.size;
          tools.set(e.index, n);
          return [delta({tool_calls: [{index: n, id: b.id, type: "function", function: {name: b.name, arguments: ""}}]})];
        }
        if (b.type === "text" && typeof b.text === "string" && b.text) return [delta({content: b.text})];
        return [];
      }
      case "content_block_delta": {
        const d = isObject(e.delta) ? e.delta : {};
        if (d.type === "text_delta" && typeof d.text === "string") return [delta({content: d.text})];
        if (d.type === "input_json_delta" && typeof d.partial_json === "string" && typeof e.index === "number" && tools.has(e.index)) {
          return [delta({tool_calls: [{index: tools.get(e.index), function: {arguments: d.partial_json}}]})];
        }
        return [];
      }
      case "message_delta": {
        const u = isObject(e.usage) ? e.usage : {};
        if (u.output_tokens !== undefined) output = count(u.output_tokens);
        if (u.input_tokens !== undefined) input.input_tokens = count(u.input_tokens);
        const finish = finishOf(isObject(e.delta) ? e.delta.stop_reason : null);
        return finish ? [delta({}, finish)] : [];
      }
      case "message_stop": {
        stopped = true;
        const prompt = input.input_tokens + input.cache_creation_input_tokens + input.cache_read_input_tokens;
        return [chunk([], {usage: {prompt_tokens: prompt, completion_tokens: output, total_tokens: prompt + output}}), enc.encode("data: [DONE]\n\n")];
      }
      case "error": {
        const err = isObject(e.error) ? e.error : {};
        throw new Error(`the provider's stream failed: ${typeof err.type === "string" ? err.type : "error"}`);
      }
      default:
        return []; // ping, content_block_stop, thinking deltas
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      for (;;) {
        const {done, value} = await reader.read();
        const datas = done ? split.end() : split.push(value);
        let wrote = false;
        for (const data of datas) {
          if (stopped) continue;
          for (const out of translate(data)) {
            ctl.enqueue(out);
            wrote = true;
          }
        }
        if (done) {
          if (!stopped) throw new Error("the provider's stream ended before the answer was finished");
          ctl.close();
          return;
        }
        if (wrote) return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** A whole Anthropic Messages answer (JSON body) to an OpenAI chat completion body, as a stream. */
export function anthropicJsonToOpenAi(source: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      for (;;) {
        const {done, value} = await reader.read();
        if (!done) {
          chunks.push(value);
          continue;
        }
        const raw = new TextDecoder().decode(Buffer.concat(chunks));
        let msg: unknown;
        try {
          msg = JSON.parse(raw);
        } catch {
          throw new Error("the provider's answer is not JSON");
        }
        ctl.enqueue(new TextEncoder().encode(JSON.stringify(fromAnthropicMessage(msg, model))));
        ctl.close();
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** The provider's Anthropic response as an OpenAI one: same status, body translated (stream or not). */
export function openAiResponseFrom(res: Response, model: string, stream: boolean): Response {
  if (!res.body) throw new Error("the provider's answer has no body");
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", stream ? "text/event-stream" : "application/json");
  const body = stream ? anthropicStreamToOpenAi(res.body, model) : anthropicJsonToOpenAi(res.body, model);
  return new Response(body, {status: res.status, statusText: res.statusText, headers});
}
