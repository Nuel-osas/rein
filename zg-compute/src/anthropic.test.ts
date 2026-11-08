import {describe, expect, it} from "vitest";
import {anthropicStreamToOpenAi, fromAnthropicMessage, toAnthropicBody, usageOf} from "./anthropic";

const sse = (events: object[]) => events.map((e) => `event: ${(e as {type: string}).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const streamOf = (text: string) => new Response(text).body!;
async function readAll(s: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(s).text();
}
const chunksOf = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((e) => e.slice("data: ".length))
    .filter((d) => d !== "[DONE]")
    .map((d) => JSON.parse(d) as {choices: {delta: Record<string, unknown>; finish_reason: string | null}[]; usage?: Record<string, number>});

describe("toAnthropicBody", () => {
  it("moves system and developer messages to `system` and keeps the turns", () => {
    const out = toAnthropicBody(
      {
        messages: [
          {role: "system", content: "Be brief."},
          {role: "system", content: [{type: "text", text: "Answer in English."}]},
          {role: "user", content: "Hi"},
          {role: "assistant", content: "Hello."},
          {role: "user", content: [{type: "text", text: "Again"}]},
        ],
        max_tokens: 64,
        stream: false,
      },
      "claude-fable-5",
    );
    expect(out).toEqual({
      body: {
        model: "claude-fable-5",
        max_tokens: 64,
        system: "Be brief.\n\nAnswer in English.",
        messages: [
          {role: "user", content: [{type: "text", text: "Hi"}]},
          {role: "assistant", content: [{type: "text", text: "Hello."}]},
          {role: "user", content: [{type: "text", text: "Again"}]},
        ],
      },
    });
  });

  it("maps tools, tool choice, tool calls and tool results, merging neighbouring turns of one role", () => {
    const out = toAnthropicBody(
      {
        messages: [
          {role: "user", content: "Weather in Lagos and Paris?"},
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {id: "call_1", type: "function", function: {name: "weather", arguments: '{"city":"Lagos"}'}},
              {id: "call_2", type: "function", function: {name: "weather", arguments: '{"city":"Paris"}'}},
            ],
          },
          {role: "tool", tool_call_id: "call_1", content: "31C"},
          {role: "tool", tool_call_id: "call_2", content: "14C"},
        ],
        tools: [{type: "function", function: {name: "weather", description: "Today's weather", parameters: {type: "object", properties: {city: {type: "string"}}}}}],
        tool_choice: "required",
        parallel_tool_calls: false,
        max_tokens: 100,
        stream: true,
      },
      "claude-opus-5",
    );
    if ("problem" in out) throw new Error(out.problem);
    expect(out.body.stream).toBe(true);
    expect(out.body.tools).toEqual([{name: "weather", description: "Today's weather", input_schema: {type: "object", properties: {city: {type: "string"}}}}]);
    expect(out.body.tool_choice).toEqual({type: "any", disable_parallel_tool_use: true});
    expect(out.body.messages).toEqual([
      {role: "user", content: [{type: "text", text: "Weather in Lagos and Paris?"}]},
      {
        role: "assistant",
        content: [
          {type: "tool_use", id: "call_1", name: "weather", input: {city: "Lagos"}},
          {type: "tool_use", id: "call_2", name: "weather", input: {city: "Paris"}},
        ],
      },
      {
        role: "user",
        content: [
          {type: "tool_result", tool_use_id: "call_1", content: "31C"},
          {type: "tool_result", tool_use_id: "call_2", content: "14C"},
        ],
      },
    ]);
  });

  it("maps stop to stop_sequences and leaves out what Claude's providers do not take", () => {
    const out = toAnthropicBody(
      {messages: [{role: "user", content: "Hi"}], max_tokens: 8, stop: "END", temperature: 0.7, top_p: 0.9, seed: 1, presence_penalty: 0.1, logit_bias: {}, stream_options: {include_usage: true}},
      "claude-fable-5",
    );
    if ("problem" in out) throw new Error(out.problem);
    expect(out.body).toEqual({model: "claude-fable-5", max_tokens: 8, messages: [{role: "user", content: [{type: "text", text: "Hi"}]}], stop_sequences: ["END"]});
  });

  it("asks Claude Opus 5 not to think, so a small max_tokens still gets an answer; Claude Fable 5 is sent as it is", () => {
    const base = {messages: [{role: "user", content: "Hi"}], max_tokens: 120};
    const opus = toAnthropicBody(base, "claude-opus-5");
    const fable = toAnthropicBody(base, "claude-fable-5");
    if ("problem" in opus || "problem" in fable) throw new Error("expected bodies");
    expect(opus.body.thinking).toEqual({type: "disabled"});
    // Fable refuses the setting (400, 30 Oct).
    expect(fable.body).not.toHaveProperty("thinking");
  });

  it("refuses what Claude cannot honour, saying which field", () => {
    const base = {messages: [{role: "user", content: "Hi"}], max_tokens: 8};
    expect(toAnthropicBody({...base, response_format: {type: "json_object"}}, "m")).toMatchObject({param: "response_format"});
    expect(toAnthropicBody({...base, tools: [{type: "code_interpreter"}]}, "m")).toMatchObject({param: "tools[0]"});
    expect(toAnthropicBody({...base, tools: [{type: "function", function: {name: "f"}}], tool_choice: {type: "x"}}, "m")).toMatchObject({param: "tool_choice"});
    expect(toAnthropicBody({messages: [{role: "assistant", content: "", function_call: {name: "f", arguments: "{}"}}], max_tokens: 8}, "m")).toMatchObject({param: "messages[0].function_call"});
    expect(toAnthropicBody({messages: [{role: "assistant", content: "", tool_calls: [{id: "c", type: "function", function: {name: "f", arguments: "{not json"}}]}], max_tokens: 8}, "m")).toMatchObject({
      param: "messages[0].tool_calls[0].function.arguments",
    });
    expect(toAnthropicBody({messages: [{role: "tool", content: "x"}], max_tokens: 8}, "m")).toMatchObject({param: "messages[0].tool_call_id"});
    expect(toAnthropicBody({messages: [{role: "system", content: "only a system prompt"}], max_tokens: 8}, "m")).toMatchObject({param: "messages"});
    // A plain text response format is the default: accepted and left out.
    expect(toAnthropicBody({...base, response_format: {type: "text"}}, "m")).not.toHaveProperty("problem");
  });
});

describe("fromAnthropicMessage", () => {
  it("joins text blocks, maps tool use to tool calls, the stop reason and the usage (cache counted as input)", () => {
    const out = fromAnthropicMessage(
      {
        id: "msg_1",
        content: [
          {type: "thinking", thinking: "never shown"},
          {type: "text", text: "Checking. "},
          {type: "tool_use", id: "toolu_1", name: "weather", input: {city: "Lagos"}},
        ],
        stop_reason: "tool_use",
        usage: {input_tokens: 10, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, output_tokens: 7},
      },
      "claude-fable-5",
    );
    expect(out).toMatchObject({
      id: "msg_1",
      object: "chat.completion",
      model: "claude-fable-5",
      choices: [
        {
          index: 0,
          message: {role: "assistant", content: "Checking. ", tool_calls: [{id: "toolu_1", type: "function", function: {name: "weather", arguments: '{"city":"Lagos"}'}}]},
          finish_reason: "tool_calls",
        },
      ],
      usage: {prompt_tokens: 15, completion_tokens: 7, total_tokens: 22},
    });
    expect(fromAnthropicMessage({content: [{type: "text", text: "x"}], stop_reason: "max_tokens"}, "m")).toMatchObject({choices: [{finish_reason: "length"}]});
  });

  it("throws on something that is not an Anthropic message", () => {
    expect(() => fromAnthropicMessage({choices: []}, "m")).toThrow();
    expect(usageOf(null)).toBeNull();
  });
});

describe("anthropicStreamToOpenAi", () => {
  it("streams text and tool calls as OpenAI chunks, then a usage chunk and [DONE]", async () => {
    const text = await readAll(
      anthropicStreamToOpenAi(
        streamOf(
          sse([
            {type: "message_start", message: {id: "msg_s", usage: {input_tokens: 12, output_tokens: 1}}},
            {type: "ping"},
            {type: "content_block_start", index: 0, content_block: {type: "text", text: ""}},
            {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "Let me check."}},
            {type: "content_block_stop", index: 0},
            {type: "content_block_start", index: 1, content_block: {type: "tool_use", id: "toolu_9", name: "weather", input: {}}},
            {type: "content_block_delta", index: 1, delta: {type: "input_json_delta", partial_json: '{"city":'}},
            {type: "content_block_delta", index: 1, delta: {type: "input_json_delta", partial_json: '"Lagos"}'}},
            {type: "content_block_stop", index: 1},
            {type: "message_delta", delta: {stop_reason: "tool_use"}, usage: {output_tokens: 20}},
            {type: "message_stop"},
          ]),
        ),
        "claude-fable-5",
      ),
    );
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const chunks = chunksOf(text);
    expect(chunks[0]!.choices[0]!.delta).toEqual({role: "assistant", content: ""});
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("Let me check.");
    const calls = chunks.flatMap((c) => (c.choices[0]?.delta?.tool_calls as {index: number; id?: string; function: {name?: string; arguments: string}}[] | undefined) ?? []);
    expect(calls[0]).toEqual({index: 0, id: "toolu_9", type: "function", function: {name: "weather", arguments: ""}});
    expect(calls.map((c) => c.function.arguments).join("")).toBe('{"city":"Lagos"}');
    expect(chunks.at(-2)!.choices[0]!.finish_reason).toBe("tool_calls");
    expect(chunks.at(-1)).toMatchObject({choices: [], usage: {prompt_tokens: 12, completion_tokens: 20, total_tokens: 32}});
  });

  it("handles events split across reads and a last event with no blank line after it", async () => {
    const whole = sse([
      {type: "message_start", message: {id: "m", usage: {input_tokens: 1, output_tokens: 0}}},
      {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "ok"}},
      {type: "message_stop"},
    ]).replace(/\n\n$/, "");
    const bytes = new TextEncoder().encode(whole);
    const source = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (let i = 0; i < bytes.length; i += 7) ctl.enqueue(bytes.slice(i, i + 7));
        ctl.close();
      },
    });
    const chunks = chunksOf(await readAll(anthropicStreamToOpenAi(source, "m")));
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("ok");
    expect(chunks.at(-1)!.usage).toEqual({prompt_tokens: 1, completion_tokens: 0, total_tokens: 1});
  });

  it("errors the stream on an error event, so it is read as cut short, never as finished", async () => {
    const s = anthropicStreamToOpenAi(
      streamOf(sse([{type: "message_start", message: {id: "m", usage: {input_tokens: 1}}}, {type: "error", error: {type: "overloaded_error", message: "Overloaded"}}])),
      "m",
    );
    await expect(readAll(s)).rejects.toThrow(/overloaded_error/);
  });

  it("errors the stream when it ends before message_stop", async () => {
    const s = anthropicStreamToOpenAi(streamOf(sse([{type: "message_start", message: {id: "m", usage: {input_tokens: 1}}}, {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "par"}}])), "m");
    await expect(readAll(s)).rejects.toThrow(/before the answer was finished/);
  });
});
