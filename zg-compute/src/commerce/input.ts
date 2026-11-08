import {keccak256, toBytes, type Hex} from "viem";
import {MONAD_BLOCK_PROMPT, type Operation} from "./operations";

/*
 * Checking and digesting a run's input. The gateway refuses an input over its operation's limits
 * before it quotes, and the quote binds the digest below, so the run performed is the run priced.
 */

export type InputProblem =
  | {code: "missing"; message: string}
  | {code: "too_long"; message: string}
  | {code: "wrong_type"; message: string}
  | {code: "too_large"; message: string};

export interface RunInput {
  prompt?: string;
  audio?: {base64: string; mimeType: string; seconds: number};
}

/** Null when the input fits the operation; otherwise what is wrong, in a person's words. */
export function checkInput(op: Operation, input: RunInput): InputProblem | null {
  if (op.id === "monad" && (input.prompt !== MONAD_BLOCK_PROMPT || input.audio !== undefined)) return {code: "wrong_type", message: "Only the fixed latest Monad block query is supported."};
  if (op.input === "prompt") {
    const p = input.prompt?.trim() ?? "";
    if (!p) return {code: "missing", message: "Write a prompt first."};
    const max = op.limits.maxPromptChars ?? 1000;
    if (p.length > max) return {code: "too_long", message: `Keep the prompt under ${max.toLocaleString("en-US")} characters.`};
    return null;
  }
  const a = input.audio;
  if (!a || !a.base64) return {code: "missing", message: "Add an audio file first."};
  if (op.limits.audioTypes && !op.limits.audioTypes.includes(a.mimeType)) return {code: "wrong_type", message: "Use an MP3, WAV, M4A, WebM or Ogg audio file."};
  const bytes = Math.floor((a.base64.length * 3) / 4);
  if (op.limits.maxAudioBytes && bytes > op.limits.maxAudioBytes) return {code: "too_large", message: "That file is too large. Keep it under 4 MB."};
  const maxS = op.limits.maxAudioSeconds ?? 60;
  if (typeof a.seconds !== "number" || !Number.isFinite(a.seconds) || a.seconds <= 0) return {code: "missing", message: "We could not read how long that audio is. Try another file."};
  if (a.seconds > maxS) return {code: "too_long", message: `Keep the audio under ${maxS} seconds.`};
  return null;
}

/** keccak256 over the operation and its normalised input. */
export function inputDigest(op: Operation, input: RunInput): Hex {
  if (op.input === "prompt") return keccak256(toBytes(`${op.id}\n${input.prompt?.trim() ?? ""}`));
  return keccak256(toBytes(`${op.id}\n${input.audio?.mimeType ?? ""}\n${input.audio?.base64 ?? ""}`));
}
