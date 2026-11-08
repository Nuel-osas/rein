/*
 * How long an audio file plays, read from the file itself: an upper bound on what a decoder will
 * produce from these bytes, never only the figure a header states.
 *
 * Speech to text is billed on the audio's actual length (the provider reports
 * {"type":"duration","seconds":N}), but a quote is priced from the operation's limit and the
 * measured length. A 4 MB file at a low bitrate can play for over an hour, so the adapter reads the
 * length before it spends anything and refuses audio it cannot read or that runs long.
 *
 * A decoder plays every frame it finds, whatever the headers say: ffmpeg reads on past a WAV data
 * chunk into the next one, resyncs over junk between MP3 frames and between Ogg pages, plays chained
 * Ogg streams one after another, and decodes every WebM block whatever its timestamp or the
 * Duration header claims. So lengths are counted from the coded frames, and a header's own figure
 * can only raise the result (a header-reading biller would charge that), never lower it:
 *   WAV   every byte from the first data chunk to the end, at the smallest byte rate the format
 *         allows (PCM and float only: a compressed payload plays longer than its bytes say)
 *   MP3   every frame header in the file, resyncing over junk, samples / sample rate; at least
 *         the frame count a Xing, Info or VBRI header declares
 *   M4A   every AAC sample in the sample tables and movie fragments x 1,024 / the
 *         AudioSpecificConfig's core sample rate; at least what mvhd, mdhd and stts declare
 *   Ogg   every Opus packet's duration from its TOC byte (Vorbis: half its long block), over every
 *         page and chained stream, resyncing over junk; at least each stream's last granule
 *   WebM  every Opus (or Vorbis) frame in every SimpleBlock and Block, laced frames included; at
 *         least the Duration header and the last block timestamp
 *
 * Structures a decoder would read differently from this walk are refused rather than guessed: MP3
 * frames of more than one MPEG version, layer or sample rate (a decoder skips the odd ones and
 * resyncs inside them), free-format MP3, Ogg pages whose CRC fails (a demuxer resyncs inside them),
 * WebM elements that run past their parent or the end of the file, and any codec not listed above.
 *
 * The container is told by its first bytes, never by the declared type: the provider decodes the
 * bytes, so they are what is measured. Every read is bounds-checked, every loop moves forward and
 * the work per file is capped, so a crafted file can make this return null (refused) or a long
 * length (refused), but never throw, hang, or allocate by a length the file declares.
 */

export type AudioFormat = "wav" | "mp3" | "mp4" | "ogg" | "webm";

export interface AudioLength {
  format: AudioFormat;
  seconds: number;
}

/** A read past the end, or a structure that cannot be measured. Never leaves this module. */
class Unreadable extends Error {}

/**
 * Seconds past which counting stops: anything this long is refused whatever the rest holds, and
 * stopping here bounds the work a file of tiny frames can cause.
 */
export const AUDIO_COUNT_CEILING_SECONDS = 3600;
class Enough extends Error {}
const enough = (seconds: number) => {
  if (seconds > AUDIO_COUNT_CEILING_SECONDS) throw new Enough();
};

function need(b: Uint8Array, at: number, n: number): void {
  if (!(at >= 0) || at + n > b.length) throw new Unreadable();
}
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16le = (b: Uint8Array, at: number) => (need(b, at, 2), b[at]! | (b[at + 1]! << 8));
const u16be = (b: Uint8Array, at: number) => (need(b, at, 2), (b[at]! << 8) | b[at + 1]!);
const u32le = (b: Uint8Array, at: number) => (need(b, at, 4), (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000);
const u32be = (b: Uint8Array, at: number) => (need(b, at, 4), b[at]! * 0x1000000 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!));
const u64be = (b: Uint8Array, at: number) => u32be(b, at) * 0x100000000 + u32be(b, at + 4);

export function sniffAudio(b: Uint8Array): AudioFormat | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (b.length >= 8 && ascii(b, 4, 4) === "ftyp") return "mp4";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "ogg";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "mp3";
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "mp3";
  return null;
}

/** The play length, or null when the file is not one of these containers or cannot be measured. */
export function audioLength(b: Uint8Array): AudioLength | null {
  const format = sniffAudio(b);
  if (!format) return null;
  let seconds: number | null = null;
  try {
    seconds = {wav, mp3, mp4, ogg, webm}[format](b);
  } catch (err) {
    // Past the ceiling: long, and refused as long. Anything else a malformed file provokes: unreadable.
    seconds = err instanceof Enough ? AUDIO_COUNT_CEILING_SECONDS + 1 : null;
  }
  if (seconds === null || !Number.isFinite(seconds) || !(seconds > 0)) return null;
  return {format, seconds: Math.min(seconds, AUDIO_COUNT_CEILING_SECONDS + 1)};
}

// --- WAV ---------------------------------------------------------------------------------------

function wav(b: Uint8Array): number | null {
  let at = 12;
  let perSecond = 0;
  while (at + 8 <= b.length) {
    const id = ascii(b, at, 4);
    const size = u32le(b, at + 4);
    const data = at + 8;
    if (id === "fmt ") {
      if (size < 16) return null;
      let tag = u16le(b, data);
      const channels = u16le(b, data + 2);
      const rate = u32le(b, data + 4);
      const byteRate = u32le(b, data + 8);
      const blockAlign = u16le(b, data + 12);
      const bits = u16le(b, data + 14);
      // WAVE_FORMAT_EXTENSIBLE: the SubFormat GUID starts with the real format tag.
      if (tag === 0xfffe) tag = size >= 40 ? u16le(b, data + 24) : 0;
      // PCM and IEEE float only. A compressed payload (ADPCM, MP3 in WAV) plays longer than its byte
      // count at the declared byte rate, so it cannot be measured this way.
      if (tag !== 1 && tag !== 3) return null;
      if (!channels || !rate || !bits) return null;
      // The smallest byte rate the header allows: a decoder sizes samples from the layout, not from
      // the declared byte rate, so the longest reading is the one that cannot be short.
      perSecond = Math.min(...[rate * channels * Math.ceil(bits / 8), byteRate, rate * blockAlign].filter((r) => r > 0));
    } else if (id === "data") {
      if (!perSecond) return null; // samples before their format
      // Everything from here to the end may be played: a decoder reads on into a later data chunk,
      // and a streamed file leaves this size at 0 or 0xffffffff.
      return (b.length - data) / perSecond;
    }
    at = data + size + (size & 1);
  }
  return null;
}

// --- MP3 ---------------------------------------------------------------------------------------

const MP3_BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000]};

interface Mp3Frame {
  version: 1 | 2 | 25;
  /** MPEG version, layer and sample rate: what a decoder requires to stay the same across a stream. */
  family: string;
  length: number;
  samples: number;
  rate: number;
}

/** The frame whose header starts at `at`, "free" for a free-format header, or null for no header. */
function mp3Frame(b: Uint8Array, at: number): Mp3Frame | "free" | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) return null;
  const v = (b[at + 1]! >> 3) & 3; // 0 = 2.5, 2 = 2, 3 = 1
  const layerBits = (b[at + 1]! >> 1) & 3; // 1 = III, 2 = II, 3 = I
  const brIndex = (b[at + 2]! >> 4) & 15;
  const srIndex = (b[at + 2]! >> 2) & 3;
  if (v === 1 || layerBits === 0 || brIndex === 15 || srIndex === 3) return null;
  if (brIndex === 0) return "free";
  const version = v === 3 ? 1 : v === 2 ? 2 : 25;
  const layer = 4 - layerBits;
  const pad = (b[at + 2]! >> 1) & 1;
  const kbps = MP3_BITRATES[`${version === 1 ? 1 : 2}-${layer}`]![brIndex]!;
  const rate = MP3_RATES[version]![srIndex]!;
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor((12 * kbps * 1000) / rate) + pad) * 4 : Math.floor(((samples / 8) * kbps * 1000) / rate) + pad;
  return length >= 4 ? {version, family: `${version}-${layer}-${rate}`, length, samples, rate} : null;
}

/** The frame count a Xing/Info or VBRI header in this frame declares (0 if it gives none), or null when it has neither. */
function mp3DeclaredFrames(b: Uint8Array, at: number, f: Mp3Frame): number | null {
  const mono = ((b[at + 3]! >> 6) & 3) === 3;
  const sideInfo = f.version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const x = at + 4 + sideInfo;
  const tag = ascii(b, x, 4);
  if (tag === "Xing" || tag === "Info") return x + 12 <= b.length && u32be(b, x + 4) & 1 ? u32be(b, x + 8) : 0;
  if (ascii(b, at + 36, 4) === "VBRI") return at + 54 <= b.length ? u32be(b, at + 50) : 0;
  return null;
}

/** A well-formed ID3v2 header (as ffmpeg checks it): only then does a decoder skip the tag. */
const id3At = (b: Uint8Array, at: number) =>
  at + 10 <= b.length && ascii(b, at, 3) === "ID3" && b[at + 3]! < 0xff && b[at + 4]! < 0xff && (b[at + 6]! | b[at + 7]! | b[at + 8]! | b[at + 9]!) < 0x80;

function mp3(b: Uint8Array): number | null {
  let at = 0;
  while (id3At(b, at)) {
    const size = (b[at + 6]! << 21) | (b[at + 7]! << 14) | (b[at + 8]! << 7) | b[at + 9]!;
    at += 10 + size + (b[at + 5]! & 0x10 ? 10 : 0);
  }
  let seconds = 0;
  let declared = 0;
  let frames = 0;
  let family: string | null = null;
  while (at + 4 <= b.length) {
    const f = mp3Frame(b, at);
    // Free-format frames state no length, and some decoders (mpg123) play them: not measurable.
    if (f === "free") return null;
    if (!f) {
      at++; // junk: a decoder resyncs on the next frame header, so read on rather than stop
      continue;
    }
    // A decoder keeps to one version, layer and rate and resyncs past a header that differs, so the
    // bytes such a header claims could hold frames it plays. Not measurable: refused.
    family ??= f.family;
    if (f.family !== family) return null;
    const info = frames === 0 ? mp3DeclaredFrames(b, at, f) : null;
    if (info !== null) {
      // The first frame of a VBR or LAME file is a Xing/Info (or VBRI) header, not audio. A tool that
      // reads the length from it reports this count, so the length is at least that.
      declared = (info * f.samples) / f.rate;
    } else {
      seconds += f.samples / f.rate;
      enough(seconds);
    }
    frames++;
    at += f.length;
  }
  return frames > 0 ? Math.max(seconds, declared) : null;
}

// --- M4A (MP4) ---------------------------------------------------------------------------------

interface Box {
  type: string;
  /** First byte of the payload. */
  start: number;
  /** One past the last byte, clipped to the parent. */
  end: number;
}

/** Boxes read per file. A legitimate file needs a few thousand; a maze of tiny boxes is refused. */
const MP4_BOX_BUDGET = 200_000;
let boxBudget = MP4_BOX_BUDGET;
/** Too much structure to walk: refused, and never swallowed by a per-box fallback. */
class TooComplex extends Unreadable {}

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    if (--boxBudget < 0) throw new TooComplex();
    let size = u32be(b, at);
    let header = 8;
    if (size === 1) {
      size = u64be(b, at + 8);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) throw new Unreadable();
    yield {type: ascii(b, at + 4, 4), start: at + header, end: Math.min(at + size, end)};
    at += size;
  }
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** AAC object types whose frame is at most 1,024 samples at the core rate, and the low-delay ones at 512. */
const AAC_1024 = new Set([1, 2, 3, 4, 5, 6, 17, 19, 20, 29]);
const AAC_512 = new Set([23, 39]);

interface Mp4Track {
  id: number | null;
  audio: boolean;
  timescale: number;
  /** mdhd duration and the stts total, in timescale ticks (declared figures). */
  mdhd: number;
  stts: number;
  /** Samples in the sample table. */
  samples: number;
  /** Most samples one coded frame plays, and at what rate; null when the codec cannot be measured. */
  frameSamples: number | null;
  rate: number | null;
}

/** objectTypeIndication and the AudioSpecificConfig's object type and core rate, from an esds box. */
function readEsds(b: Uint8Array, box: Box): {oti: number; aot: number | null; rate: number | null} | null {
  let at = box.start + 4; // version and flags
  const descriptor = () => {
    need(b, at, 1);
    const tag = b[at++]!;
    let len = 0;
    for (let i = 0; i < 4; i++) {
      need(b, at, 1);
      const c = b[at++]!;
      len = len * 128 + (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return {tag, start: at, end: Math.min(at + len, box.end)};
  };
  const es = descriptor();
  if (es.tag !== 3) return null;
  at = es.start + 2;
  need(b, at, 1);
  const flags = b[at++]!;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) {
    need(b, at, 1);
    at += 1 + b[at]!;
  }
  if (flags & 0x20) at += 2;
  const config = descriptor();
  if (config.tag !== 4) return null;
  need(b, config.start, 13);
  const oti = b[config.start]!;
  at = config.start + 13;
  if (at >= config.end) return {oti, aot: null, rate: null};
  const specific = descriptor();
  if (specific.tag !== 5) return {oti, aot: null, rate: null};
  let bit = specific.start * 8;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) {
      const byte = bit >> 3;
      if (byte >= specific.end) throw new Unreadable();
      v = v * 2 + ((b[byte]! >> (7 - (bit & 7))) & 1);
    }
    return v;
  };
  let aot = read(5);
  if (aot === 31) aot = 32 + read(6);
  // The first sampling frequency is the core (AAC) rate, also for explicit SBR and PS (types 5, 29).
  const index = read(4);
  const rate = index === 15 ? read(24) : (AAC_RATES[index] ?? 0);
  return {oti, aot, rate: rate > 0 ? rate : null};
}

function readStsd(b: Uint8Array, stsd: Box, t: Mp4Track): void {
  if (u32be(b, stsd.start + 4) !== 1) return; // several sample descriptions: not measured
  const entry = boxes(b, stsd.start + 8, stsd.end).next().value as Box | undefined;
  if (!entry || entry.type !== "mp4a") return; // AAC only (ALAC, Opus, MP3 in MP4 and others are refused)
  const qtVersion = u16be(b, entry.start + 8);
  const entryRate = u16be(b, entry.start + 24);
  const children = entry.start + (qtVersion === 1 ? 44 : qtVersion === 2 ? 64 : 28);
  let esds: ReturnType<typeof readEsds> = null;
  for (const c of boxes(b, children, entry.end)) if (c.type === "esds") esds = readEsds(b, c);
  if (!esds) return;
  if (esds.oti === 0x40) {
    // MPEG-4 audio: the decoder runs at the AudioSpecificConfig's rate, whatever the entry says.
    if (esds.aot === null || esds.rate === null) return;
    t.frameSamples = AAC_1024.has(esds.aot) ? 1024 : AAC_512.has(esds.aot) ? 512 : null;
    t.rate = esds.rate;
  } else if (esds.oti === 0x66 || esds.oti === 0x67 || esds.oti === 0x68) {
    // MPEG-2 AAC
    t.frameSamples = 1024;
    t.rate = esds.rate ?? (entryRate > 0 ? entryRate : null);
  }
}

function readTrak(b: Uint8Array, trak: Box): Mp4Track {
  const t: Mp4Track = {id: null, audio: false, timescale: 0, mdhd: 0, stts: 0, samples: 0, frameSamples: null, rate: null};
  for (const x of boxes(b, trak.start, trak.end)) {
    if (x.type === "tkhd") t.id = u32be(b, x.start + (b[x.start] === 1 ? 20 : 12));
    if (x.type !== "mdia") continue;
    for (const y of boxes(b, x.start, x.end)) {
      if (y.type === "hdlr") t.audio = ascii(b, y.start + 8, 4) === "soun";
      else if (y.type === "mdhd") {
        const v1 = b[y.start] === 1;
        t.timescale = u32be(b, y.start + (v1 ? 20 : 12));
        t.mdhd = v1 ? u64be(b, y.start + 24) : u32be(b, y.start + 16);
      } else if (y.type === "minf") {
        for (const z of boxes(b, y.start, y.end)) {
          if (z.type !== "stbl") continue;
          for (const s of boxes(b, z.start, z.end)) {
            if (s.type === "stsz" || s.type === "stz2") t.samples += u32be(b, s.start + 8);
            else if (s.type === "stsd") readStsd(b, s, t);
            else if (s.type === "stts") {
              const n = u32be(b, s.start + 4);
              for (let i = 0, e = s.start + 8; i < n && e + 8 <= s.end; i++, e += 8) t.stts += u32be(b, e) * u32be(b, e + 4);
            }
          }
        }
      }
    }
  }
  return t;
}

/** Samples per track id in the movie fragment ('moof') whose type tag is at `tag`; null when it is not one. */
function readMoof(b: Uint8Array, tag: number): Map<number | null, number> | null {
  const start = tag - 4;
  let size = u32be(b, start);
  let header = 8;
  if (size === 1) {
    size = u64be(b, tag + 4);
    header = 16;
  }
  if (size < header + 8 || start + size > b.length) return null;
  const out = new Map<number | null, number>();
  for (const traf of boxes(b, start + header, start + size)) {
    if (traf.type !== "traf") continue;
    let id: number | null = null;
    let n = 0;
    for (const x of boxes(b, traf.start, traf.end)) {
      if (x.type === "tfhd") id = u32be(b, x.start + 4);
      else if (x.type === "trun") n += u32be(b, x.start + 4);
    }
    out.set(id, (out.get(id) ?? 0) + n);
  }
  return out;
}

function mp4(b: Uint8Array): number | null {
  boxBudget = MP4_BOX_BUDGET;
  let declared = 0;
  const tracks: Mp4Track[] = [];
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== "moov") continue;
    for (const x of boxes(b, top.start, top.end)) {
      if (x.type === "mvhd") {
        const v1 = b[x.start] === 1;
        const scale = u32be(b, x.start + (v1 ? 20 : 12));
        const duration = v1 ? u64be(b, x.start + 24) : u32be(b, x.start + 16);
        if (scale) declared = Math.max(declared, duration / scale);
      } else if (x.type === "trak") tracks.push(readTrak(b, x));
    }
  }
  // Movie fragments are counted wherever a 'moof' box is found, not only at the top level: a
  // decoder can reach a fragment through an index (sidx, mfra) even when a box before it claims
  // its bytes. A false match inside media data only adds samples, which can only refuse sooner.
  /** Samples in movie fragments, by track id (null when a fragment names none). */
  const fragments = new Map<number | null, number>();
  for (let at = 4; at + 4 <= b.length; at++) {
    if (b[at] !== 0x6d || b[at + 1] !== 0x6f || b[at + 2] !== 0x6f || b[at + 3] !== 0x66) continue; // "moof"
    let moof: Map<number | null, number> | null = null;
    try {
      moof = readMoof(b, at);
    } catch (err) {
      if (err instanceof TooComplex) throw err;
      moof = null; // not a fragment a decoder could read either
    }
    for (const [id, n] of moof ?? []) fragments.set(id, (fragments.get(id) ?? 0) + n);
  }
  const audio = tracks.filter((t) => t.audio);
  if (audio.length === 0) return null;
  let longest = 0;
  for (const t of audio) {
    if (t.frameSamples === null || !t.rate) return null; // an audio track it cannot measure
    // Fragment samples for this track, and any for a track the file does not describe.
    let fragmentSamples = 0;
    for (const [id, n] of fragments) if (id === t.id || !tracks.some((o) => o.id === id)) fragmentSamples += n;
    let s = ((t.samples + fragmentSamples) * t.frameSamples) / t.rate;
    if (t.timescale) s = Math.max(s, t.mdhd / t.timescale, t.stts / t.timescale);
    longest = Math.max(longest, s);
  }
  return Math.max(longest, declared);
}

// --- Opus --------------------------------------------------------------------------------------

/** The longest an Opus packet can play (RFC 6716): used for a packet that cannot be read. */
const OPUS_MAX_SECONDS = 0.12;

/** Seconds one Opus packet plays, from its TOC byte (RFC 6716 section 3.1). */
function opusPacketSeconds(b: Uint8Array, at: number, length: number): number {
  if (length < 1 || at >= b.length) return OPUS_MAX_SECONDS;
  const toc = b[at]!;
  const config = toc >> 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config & 3]! : config < 16 ? [10, 20][config & 1]! : [2.5, 5, 10, 20][config & 3]!;
  const code = toc & 3;
  const count = code === 0 ? 1 : code < 3 ? 2 : length >= 2 && at + 1 < b.length ? b[at + 1]! & 0x3f : 0;
  if (count === 0) return OPUS_MAX_SECONDS;
  return Math.min(count * frameMs, 120) / 1000;
}

/** Vorbis identification header: sample rate and long block size, or null when it is not one. */
function vorbisIdent(b: Uint8Array, at: number): {rate: number; longBlock: number} | null {
  if (at + 30 > b.length || b[at] !== 1 || ascii(b, at + 1, 6) !== "vorbis") return null;
  const rate = u32le(b, at + 12);
  const longBlock = 1 << (b[at + 28]! >> 4);
  return rate > 0 && longBlock >= 64 && longBlock <= 8192 ? {rate, longBlock} : null;
}

// --- Ogg ---------------------------------------------------------------------------------------

/** Ogg's CRC-32: polynomial 0x04c11db7, not reflected, initial 0, no final xor. */
const OGG_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Whether the page of `length` bytes at `at` carries its own CRC (computed with that field zeroed). */
function oggCrcOk(b: Uint8Array, at: number, length: number): boolean {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    const byte = i >= 22 && i < 26 ? 0 : b[at + i]!;
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc === u32le(b, at + 22);
}

interface OggStream {
  codec: "opus" | "vorbis" | "other" | null;
  packets: number;
  seconds: number;
  rate: number;
  longBlock: number;
  /** The last segment read had lacing 255, so a packet is still open. */
  open: boolean;
  /** The last granule position seen (a declared figure). */
  granule: number;
}

function ogg(b: Uint8Array): number | null {
  const live = new Map<number, OggStream>();
  const all: OggStream[] = [];
  const startStream = (serial: number) => {
    const s: OggStream = {codec: null, packets: 0, seconds: 0, rate: 0, longBlock: 0, open: false, granule: 0};
    live.set(serial, s);
    all.push(s);
    return s;
  };
  let counted = 0;

  const packet = (s: OggStream, at: number, firstSegment: number) => {
    s.packets++;
    if (s.packets === 1) {
      if (ascii(b, at, 8) === "OpusHead") {
        s.codec = "opus";
        s.rate = 48_000; // Opus granule positions count 48 kHz samples
      } else {
        const v = vorbisIdent(b, at);
        if (v) Object.assign(s, {codec: "vorbis", rate: v.rate, longBlock: v.longBlock});
        else s.codec = "other";
      }
      return;
    }
    // Opus: OpusHead, OpusTags. Vorbis: identification, comment, setup. Then audio.
    let add = 0;
    if (s.codec === "opus" && s.packets > 2) add = opusPacketSeconds(b, at, firstSegment);
    // A Vorbis audio packet plays at most half a long block.
    else if (s.codec === "vorbis" && s.packets > 3 && !(at < b.length && b[at]! & 1)) add = s.longBlock / 2 / s.rate;
    s.seconds += add;
    counted += add;
    enough(counted);
  };

  // Bytes hashed checking page CRCs: each byte once for a sound file; a file of overlapping fake
  // pages is refused rather than hashed over and over.
  let crcBudget = 4 * b.length + 65_536;
  let at = 0;
  while (at + 27 <= b.length) {
    if (b[at] !== 0x4f || b[at + 1] !== 0x67 || b[at + 2] !== 0x67 || b[at + 3] !== 0x53) {
      at++; // junk between pages: a demuxer resyncs on the next capture pattern
      continue;
    }
    const flags = b[at + 5]!;
    const lo = u32le(b, at + 6);
    const hi = u32le(b, at + 10);
    const serial = u32le(b, at + 14);
    const segments = b[at + 26]!;
    const table = at + 27;
    let length = 27 + segments;
    for (let i = 0; i < segments && table + i < b.length; i++) length += b[table + i]!;
    // Not a page when it is cut off at the end or fails its CRC: demuxers check it and resync
    // inside a page that fails, so whatever it claims to hold is read on as possible pages.
    if (at + length > b.length) {
      at++;
      continue;
    }
    crcBudget -= length;
    if (crcBudget < 0) return null;
    if (!oggCrcOk(b, at, length)) {
      at++;
      continue;
    }
    // A new beginning-of-stream page starts a stream, also when it reuses a serial (chaining).
    const s = flags & 2 || !live.has(serial) ? startStream(serial) : live.get(serial)!;
    if (!(lo === 0xffffffff && hi === 0xffffffff)) s.granule = hi * 0x100000000 + lo;
    // A continued page whose start we never saw begins with a packet's tail: not a packet start.
    let skipping = (flags & 1) !== 0 && !s.open;
    if (!(flags & 1)) s.open = false; // an open packet cut short is dropped by the decoder
    let pos = table + segments;
    for (let i = 0; i < segments; i++) {
      const lace = b[table + i]!;
      if (skipping) {
        if (lace < 255) skipping = false;
      } else {
        if (!s.open) packet(s, pos, lace);
        s.open = lace === 255;
      }
      pos += lace;
    }
    at = pos;
  }

  let total = 0;
  for (const s of all) {
    if (s.packets === 0) continue;
    if (s.codec !== "opus" && s.codec !== "vorbis") return null; // a stream it cannot measure
    total += Math.max(s.seconds, s.granule / s.rate);
  }
  return total > 0 ? total : null;
}

// --- WebM (Matroska) ---------------------------------------------------------------------------

const EBML = {
  Header: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  Block: 0xa1,
} as const;

/** Elements walked into rather than skipped. Each may have an unknown size (live recordings). */
const MASTERS = new Set<number>([EBML.Header, EBML.Segment, EBML.Info, EBML.Tracks, EBML.TrackEntry, EBML.Audio, EBML.Cluster, EBML.BlockGroup]);

/** EBML variable-length integer: [value, length]; value -1 when all value bits are 1 (unknown size). */
function vint(b: Uint8Array, at: number, keepMarker: boolean): [number, number] {
  need(b, at, 1);
  const first = b[at]!;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Unreadable();
  need(b, at, len);
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return [!keepMarker && allOnes ? -1 : value, len];
}

function ebmlUint(b: Uint8Array, at: number, size: number): number {
  if (size > 8) throw new Unreadable();
  need(b, at, size);
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[at + i]!;
  return v;
}

function ebmlFloat(b: Uint8Array, at: number, size: number): number {
  if (size === 0) return 0;
  if (size !== 4 && size !== 8) throw new Unreadable();
  need(b, at, size);
  const view = new DataView(b.buffer, b.byteOffset + at, size);
  return size === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

interface MkvTrack {
  number: number;
  type: number;
  codec: string;
  private: [number, number] | null;
  seconds: number;
  vorbis: {rate: number; longBlock: number} | null | undefined;
}

/** The Vorbis identification header inside a Xiph-laced CodecPrivate. */
function mkvVorbis(b: Uint8Array, [start, end]: [number, number]): {rate: number; longBlock: number} | null {
  if (start >= end) return null;
  let at = start + 1; // packet count - 1, then the first packets' Xiph-laced sizes
  for (let k = 0; k < b[start]!; k++) {
    let c = 255;
    while (c === 255) {
      need(b, at, 1);
      c = b[at++]!;
    }
  }
  return at < end ? vorbisIdent(b, at) : null;
}

interface BlockHeader {
  track: number;
  /** Timestamp relative to the cluster, signed. */
  rel: number;
  /** 0 none, 1 Xiph, 2 fixed-size, 3 EBML. */
  lacing: number;
  /** First byte after the block header. */
  body: number;
}

function blockHeader(b: Uint8Array, data: number): BlockHeader {
  const [track, trackLen] = vint(b, data, false);
  const p = data + trackLen;
  need(b, p, 3);
  return {track, rel: (((b[p]! << 8) | b[p + 1]!) << 16) >> 16, lacing: (b[p + 2]! >> 1) & 3, body: p + 3};
}

/**
 * Calls `frame(start, length)` for each frame in a block (at most 256). When the lacing cannot be
 * read every frame is passed with length -1, to be counted at the longest a frame can play.
 */
function eachBlockFrame(b: Uint8Array, h: BlockHeader, end: number, frame: (start: number, length: number) => void): void {
  let p = h.body;
  if (h.lacing === 0) return frame(p, end - p);
  need(b, p, 1);
  const n = b[p]! + 1;
  p += 1;
  const sizes: number[] = [];
  try {
    if (h.lacing === 1) {
      // Xiph lacing: each size but the last as a run of 255s and a final byte
      for (let k = 0; k < n - 1; k++) {
        let size = 0;
        let c = 255;
        while (c === 255) {
          need(b, p, 1);
          c = b[p++]!;
          size += c;
        }
        sizes.push(size);
      }
    } else if (h.lacing === 3) {
      // EBML lacing: the first size, then signed differences
      const [first, len] = vint(b, p, false);
      p += len;
      sizes.push(first);
      for (let k = 1; k < n - 1; k++) {
        const [raw, l] = vint(b, p, false);
        p += l;
        sizes.push(sizes[k - 1]! + raw - (2 ** (7 * l - 1) - 1));
      }
    } else {
      for (let k = 0; k < n - 1; k++) sizes.push((end - p) / n); // fixed-size lacing
    }
    sizes.push(end - p - sizes.reduce((a, s) => a + s, 0));
  } catch {
    sizes.length = 0;
  }
  if (sizes.length !== n || sizes.some((s) => !Number.isInteger(s) || s < 0)) {
    for (let k = 0; k < n; k++) frame(p, -1);
    return;
  }
  for (const s of sizes) {
    frame(p, s);
    p += s;
  }
}

function webm(b: Uint8Array): number | null {
  let scale = 1_000_000; // TimecodeScale, ns per tick
  let duration = 0;
  let cluster = 0;
  let maxTick = 0;
  const entries: Partial<MkvTrack>[] = [];
  const tracks = new Map<number, MkvTrack>();
  const current = () => entries[entries.length - 1] ?? {};
  const trackFor = (number: number): MkvTrack | null => {
    let t = tracks.get(number);
    if (!t) {
      const e = entries.find((x) => x.number === number);
      if (!e) return null;
      t = {number, type: e.type ?? 0, codec: e.codec ?? "", private: e.private ?? null, seconds: 0, vorbis: undefined};
      tracks.set(number, t);
    }
    return t;
  };

  let counted = 0;
  const add = (t: MkvTrack, seconds: number) => {
    t.seconds += seconds;
    counted += seconds;
    enough(counted);
  };

  /** Ends of the known-size masters the walk is inside, innermost last. */
  const ends: number[] = [];
  let at = 0;
  while (at < b.length) {
    while (ends.length > 0 && at >= ends[ends.length - 1]!) ends.pop();
    const [id, idLen] = vint(b, at, true);
    const [size, sizeLen] = vint(b, at + idLen, false);
    const data = at + idLen + sizeLen;
    // An element that runs past its parent or the end of the file: a demuxer resyncs inside it and
    // could play what it claims to hold, so the file is not measurable.
    if (size >= 0 && data + size > (ends[ends.length - 1] ?? b.length)) return null;
    if (MASTERS.has(id)) {
      if (id === EBML.TrackEntry) entries.push({});
      if (size >= 0) ends.push(data + size);
      at = data; // walk into it: a master may have an unknown size, so its bytes are read in order
      continue;
    }
    if (size < 0) return null; // only a master may have an unknown size
    const end = data + size;
    switch (id) {
      case EBML.TimecodeScale:
        scale = ebmlUint(b, data, size);
        break;
      case EBML.Duration:
        duration = ebmlFloat(b, data, size);
        break;
      case EBML.Timecode:
        cluster = ebmlUint(b, data, size);
        break;
      case EBML.TrackNumber:
        current().number = ebmlUint(b, data, size);
        break;
      case EBML.TrackType:
        current().type = ebmlUint(b, data, size);
        break;
      case EBML.CodecID:
        current().codec = ascii(b, data, Math.min(size, 32));
        break;
      case EBML.CodecPrivate:
        current().private = [data, end];
        break;
      case EBML.SimpleBlock:
      case EBML.Block: {
        const h = blockHeader(b, data);
        const t = trackFor(h.track);
        if (!t) return null; // a block for a track the file never described
        maxTick = Math.max(maxTick, cluster + h.rel);
        if (!(t.type === 2 || t.codec.startsWith("A_"))) break; // not audio
        if (t.codec === "A_OPUS") {
          eachBlockFrame(b, h, end, (start, length) => add(t, length < 0 ? OPUS_MAX_SECONDS : opusPacketSeconds(b, start, length)));
        } else if (t.codec === "A_VORBIS") {
          if (t.vorbis === undefined) t.vorbis = t.private ? mkvVorbis(b, t.private) : null;
          const v = t.vorbis;
          if (!v) return null;
          eachBlockFrame(b, h, end, () => add(t, v.longBlock / 2 / v.rate));
        } else return null; // another audio codec: not measured
        break;
      }
    }
    at = end;
  }

  let longest = 0;
  for (const t of tracks.values()) longest = Math.max(longest, t.seconds);
  const declared = Math.max(duration > 0 && Number.isFinite(duration) ? (duration * scale) / 1e9 : 0, (maxTick * scale) / 1e9);
  return Math.max(longest, declared);
}
