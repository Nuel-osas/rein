// The body of a compute quote or buy, as a route reads it, before core.checkInput looks deeper.
//   { team, service, prompt? , audio?: { base64, mime? }, authority? }
// Audio is standard base64 of the file's bytes (no data: prefix), at most AUDIO_MAX_BYTES once decoded.

import { parseAddress } from '@/lib/chain';
import { AUDIO_MAX_BYTES } from './catalog';
import { decodeBase64, isComputeService, SERVICE_TABLE, type ComputeService, type QuoteAudio } from './core';

/** The most a request body may be: the audio's base64 plus a little JSON (under Vercel's 4.5 MB cap). */
export const BODY_MAX_CHARS = Math.ceil((AUDIO_MAX_BYTES * 4) / 3) + 16_384;

export type ComputeRequest = { team: string; service: ComputeService; prompt?: string; audio: QuoteAudio | null; authority: string | null | undefined };

export async function readComputeRequest(req: Request, opts: { defaultTeam?: string | null } = {}): Promise<ComputeRequest | { error: string; status: number }> {
  let body: { team?: unknown; service?: unknown; prompt?: unknown; audio?: unknown; authority?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > BODY_MAX_CHARS) return { error: 'request too large (audio is at most 3 MB)', status: 413 };
    body = JSON.parse(raw);
  } catch {
    return { error: 'bad json', status: 400 };
  }
  if (!body || typeof body !== 'object') return { error: 'bad request', status: 400 };
  const team = body.team === undefined && opts.defaultTeam ? opts.defaultTeam : parseAddress(typeof body.team === 'string' ? body.team : null);
  if (!team) return { error: 'team must be a team account address', status: 400 };
  if (!isComputeService(body.service)) return { error: `service must be one of: ${Object.keys(SERVICE_TABLE).join(', ')}`, status: 400 };
  if (body.prompt !== undefined && typeof body.prompt !== 'string') return { error: 'prompt must be a string', status: 400 };
  let audio: QuoteAudio | null = null;
  if (body.audio !== undefined && body.audio !== null) {
    const a = body.audio as { base64?: unknown; mime?: unknown };
    if (typeof a !== 'object') return { error: 'audio must be { base64, mime }', status: 400 };
    const bytes = decodeBase64(a.base64, AUDIO_MAX_BYTES);
    if (!bytes) return { error: 'audio.base64 must be base64 of an audio file of at most 3 MB', status: 400 };
    if (a.mime !== undefined && (typeof a.mime !== 'string' || a.mime.length > 100)) return { error: 'audio.mime must be a MIME type', status: 400 };
    audio = { bytes, mime: a.mime as string | undefined };
  }
  let authority: string | null | undefined;
  if (body.authority !== undefined) {
    authority = parseAddress(typeof body.authority === 'string' ? body.authority : null);
    if (!authority) return { error: 'authority must be a public key', status: 400 };
  }
  return { team, service: body.service, prompt: body.prompt as string | undefined, audio, authority };
}
