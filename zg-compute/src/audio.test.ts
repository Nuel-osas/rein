import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {AUDIO_COUNT_CEILING_SECONDS, audioLength, sniffAudio} from "./audio";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", "audio", name)));
const cat = (...parts: (Uint8Array | number[])[]) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
const seconds = (b: Uint8Array) => audioLength(b)?.seconds ?? null;

/*
 * Fixtures are 2.5 s sine tones written by ffmpeg (ffprobe: wav, mp3, m4a 2.500; ogg 2.5065;
 * webm 2.508; tone-live.webm has no duration, as MediaRecorder writes it; tone-frag.m4a is a
 * fragmented MP4 as Safari records), plus the 4.89 s spoken clip from the live probe (the provider
 * billed it as 5 seconds).
 */
describe("audioLength", () => {
  // [file, format, true length, most it may read over]. It may read a little long (an MP3 counts
  // the encoder's padding frames, an M4A its priming samples, Opus its last packet's padding),
  // which only refuses sooner; it must never read short.
  const cases: [string, string, number, number][] = [
    ["tone.wav", "wav", 2.5, 0.001],
    ["tone.mp3", "mp3", 2.5, 0.15],
    ["tone.m4a", "mp4", 2.5, 0.15],
    ["tone-frag.m4a", "mp4", 2.5, 0.15],
    ["tone.ogg", "ogg", 2.5, 0.05],
    ["tone.webm", "webm", 2.5, 0.05],
    ["tone-live.webm", "webm", 2.5, 0.05],
    ["speech-4.9s.mp3", "mp3", 4.885, 0.15],
  ];
  for (const [name, format, length, over] of cases) {
    it(`reads ${name}`, () => {
      const r = audioLength(fixture(name));
      expect(r?.format).toBe(format);
      expect(r!.seconds).toBeGreaterThanOrEqual(length - 0.03);
      expect(r!.seconds).toBeLessThanOrEqual(length + over);
    });
  }

  it("goes by the bytes, not the declared type", () => {
    expect(sniffAudio(fixture("tone.ogg"))).toBe("ogg");
    expect(sniffAudio(fixture("tone.m4a"))).toBe("mp4");
  });

  it("is null for anything it cannot read, so the caller fails closed", () => {
    expect(audioLength(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(audioLength(new TextEncoder().encode("RIFF\0\0\0\0WAVEjunk"))).toBeNull();
    expect(audioLength(fixture("tone.webm").subarray(0, 40))).toBeNull();
    expect(audioLength(new Uint8Array(0))).toBeNull();
  });

  it("measures a long file at a low bitrate by its length, not its size", () => {
    // 8 kHz, 8-bit mono WAV: 2.5 s is 20 kB, so 4 MB would be over 8 minutes
    expect(seconds(fixture("tone.wav"))).toBeCloseTo(2.5, 3);
  });
});

/*
 * Each case below is a file whose headers say less than a decoder plays (checked with ffmpeg when
 * these were written: it decodes every frame the walk below counts). The length read must be at
 * least what is played, or the file is refused.
 */

// --- WAV ---------------------------------------------------------------------------------------

function wavFile(o: {tag?: number; rate?: number; byteRate?: number; blockAlign?: number; bits?: number; chunks: [string, number, number?][]}) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(o.tag ?? 1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(o.rate ?? 8000, 12);
  fmt.writeUInt32LE(o.byteRate ?? 8000, 16);
  fmt.writeUInt16LE(o.blockAlign ?? 1, 20);
  fmt.writeUInt16LE(o.bits ?? 8, 22);
  const chunks = o.chunks.map(([id, bytes, declared]) => {
    const h = Buffer.alloc(8);
    h.write(id, 0);
    h.writeUInt32LE(declared ?? bytes, 4);
    return Buffer.concat([h, Buffer.alloc(bytes, 0x80)]);
  });
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0);
  riff.write("WAVE", 8);
  return cat(riff, fmt, ...chunks);
}

describe("audioLength: WAV a decoder plays longer than its header says", () => {
  it("counts a second data chunk (a decoder reads on into it)", () => {
    expect(seconds(wavFile({chunks: [["data", 8000], ["LIST", 8], ["data", 8000 * 70]]}))).toBeGreaterThanOrEqual(71);
  });

  it("counts to the end when the data size is understated", () => {
    expect(seconds(wavFile({chunks: [["data", 8000 * 70, 8000]]}))).toBeGreaterThanOrEqual(70);
  });

  it("sizes samples from the layout, not a declared byte rate", () => {
    expect(seconds(wavFile({byteRate: 8_000_000, blockAlign: 1000, chunks: [["data", 8000 * 70]]}))).toBeGreaterThanOrEqual(70);
  });

  it("refuses a compressed payload and samples before their format", () => {
    expect(audioLength(wavFile({tag: 0x55, chunks: [["data", 8000]]}))).toBeNull();
    const noFmt = cat(Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.from("data"), [0x40, 0x1f, 0, 0], Buffer.alloc(8000));
    expect(audioLength(noFmt)).toBeNull();
  });
});

// --- MP3 ---------------------------------------------------------------------------------------

/** The first audio frame of tone.mp3 (after its ID3 tag and Info frame), for building streams. */
function mp3Frames(name: string): Uint8Array {
  const b = fixture(name);
  const size = (b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!;
  return b.subarray(10 + size);
}

describe("audioLength: MP3 a decoder plays longer than its header says", () => {
  it("reads on over junk between frames (a decoder resyncs)", () => {
    const speech = fixture("speech-4.9s.mp3");
    expect(seconds(cat(speech, [0x00, 0x13, 0x37], speech))).toBeGreaterThanOrEqual(2 * 4.885);
  });

  it("counts frames, not a Xing/Info frame count that says less", () => {
    const b = Buffer.from(fixture("tone.mp3"));
    const info = b.indexOf("Info");
    expect(b.readUInt32BE(info + 4) & 1).toBe(1);
    b.writeUInt32BE(1, info + 8);
    expect(seconds(new Uint8Array(b))).toBeGreaterThanOrEqual(2.47);
  });

  it("reads at least a Xing/Info frame count that says more", () => {
    const b = Buffer.from(fixture("tone.mp3"));
    b.writeUInt32BE(100_000, b.indexOf("Info") + 8);
    expect(seconds(new Uint8Array(b))).toBeGreaterThan(60);
  });

  it("does not skip a malformed ID3 header's claimed size (a decoder does not)", () => {
    // size bytes must be under 0x80; 0x80 in the third makes the header malformed. Masked, it
    // would claim 16 KB, hiding the frames inside it.
    const header = [0x49, 0x44, 0x33, 4, 0, 0, 0x00, 0x01, 0x80, 0x00];
    expect(seconds(cat(header, mp3Frames("speech-4.9s.mp3")))).toBeGreaterThanOrEqual(4.85);
  });

  it("refuses frames of another version, layer or rate, and free-format frames", () => {
    const frames = mp3Frames("tone.mp3");
    const other = cat([0xff, 0xfb, 0x90, 0x00], new Uint8Array(413)); // MPEG-1 layer III, 128 kb/s, 44.1 kHz
    expect(audioLength(cat(frames, other, frames))).toBeNull();
    expect(audioLength(cat(frames, [0xff, 0xf3, 0x08, 0xc0], new Uint8Array(64)))).toBeNull();
  });
});

// --- M4A ---------------------------------------------------------------------------------------

/** tone.m4a with mvhd and mdhd durations at one tick and every stts delta at 1. */
function lyingM4a(): Uint8Array {
  const m = Buffer.from(fixture("tone.m4a"));
  for (const box of ["mvhd", "mdhd"]) {
    const d = m.indexOf(box) + 4;
    expect(m[d]).toBe(0);
    m.writeUInt32BE(1, d + 16);
  }
  const s = m.indexOf("stts");
  for (let k = 0; k < m.readUInt32BE(s + 8); k++) m.writeUInt32BE(1, s + 12 + k * 8 + 4);
  return new Uint8Array(m);
}

describe("audioLength: M4A a decoder plays longer than its header says", () => {
  it("counts AAC samples, not the durations mvhd, mdhd and stts declare", () => {
    expect(seconds(lyingM4a())).toBeGreaterThanOrEqual(2.47);
  });

  it("counts a movie fragment wherever it is, even inside another box", () => {
    const frag = Buffer.from(fixture("tone-frag.m4a"));
    const at = frag.indexOf("moof") - 4;
    const moof = frag.subarray(at, at + frag.readUInt32BE(at));
    const free = Buffer.alloc(8);
    free.writeUInt32BE(8 + moof.length, 0);
    free.write("free", 4);
    expect(seconds(cat(frag, free, moof))).toBeGreaterThan(seconds(frag)! + 0.2);
  });

  it("refuses a codec it cannot measure", () => {
    const m = Buffer.from(fixture("tone.m4a"));
    m.write("alac", m.indexOf("mp4a"));
    expect(audioLength(new Uint8Array(m))).toBeNull();
  });
});

// --- Ogg ---------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Each page of an Ogg file as [offset, length]. */
function oggPages(b: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let at = 0; at < b.length; ) {
    const segments = b[at + 26]!;
    let length = 27 + segments;
    for (let i = 0; i < segments; i++) length += b[at + 27 + i]!;
    out.push([at, length]);
    at += length;
  }
  return out;
}

function resealOgg(b: Buffer): void {
  for (const [at, length] of oggPages(b)) {
    b.writeUInt32LE(0, at + 22);
    let crc = 0;
    for (let i = 0; i < length; i++) crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ b[at + i]!) & 0xff]!) >>> 0;
    b.writeUInt32LE(crc, at + 22);
  }
}

describe("audioLength: Ogg a decoder plays longer than its header says", () => {
  it("counts chained streams one after another", () => {
    const ogg = fixture("tone.ogg");
    expect(seconds(cat(ogg, ogg))).toBeGreaterThanOrEqual(5);
  });

  it("reads on over junk between pages", () => {
    const ogg = fixture("tone.ogg");
    const [, , third] = oggPages(ogg);
    expect(seconds(cat(ogg.subarray(0, third![0]), [0x13, 0x37, 0x00], ogg.subarray(third![0]), [0x99], ogg))).toBeGreaterThanOrEqual(5);
  });

  it("counts packets, not a final granule that says less", () => {
    const b = Buffer.from(fixture("tone.ogg"));
    for (const [at] of oggPages(b)) {
      b.writeUInt32LE(0, at + 6);
      b.writeUInt32LE(0, at + 10);
    }
    resealOgg(b);
    expect(seconds(new Uint8Array(b))).toBeGreaterThanOrEqual(2.47);
  });

  it("reads at least a final granule that says more", () => {
    const b = Buffer.from(fixture("tone.ogg"));
    const pages = oggPages(b);
    b.writeUInt32LE(48_000 * 100, pages[pages.length - 1]![0] + 6);
    resealOgg(b);
    expect(seconds(new Uint8Array(b))).toBeGreaterThan(60);
  });

  it("does not let a page with a bad CRC swallow the pages inside it", () => {
    const ogg = fixture("tone.ogg");
    const [, , third] = oggPages(ogg);
    const fake = Buffer.alloc(27 + 255, 255);
    fake.write("OggS", 0);
    fake[4] = 0;
    fake[5] = 0;
    fake.writeUInt32LE(ogg[14]! | (ogg[15]! << 8) | (ogg[16]! << 16) | (ogg[17]! * 0x1000000), 14);
    fake[26] = 255;
    expect(seconds(cat(ogg.subarray(0, third![0]), fake, ogg.subarray(third![0])))).toBeGreaterThanOrEqual(2.47);
  });
});

// --- WebM --------------------------------------------------------------------------------------

const idBytes = (id: number) => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
};
const size8 = (n: number) => [0x01, 0, (n / 2 ** 40) & 0xff, (n / 2 ** 32) & 0xff, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const el = (id: number, ...payload: (Uint8Array | number[])[]) => {
  const body = cat(...payload);
  return cat(idBytes(id), size8(body.length), body);
};
const open = (id: number, ...children: (Uint8Array | number[])[]) => cat(idBytes(id), UNKNOWN, ...children);
const text = (s: string) => [...Buffer.from(s)];
const f64 = (v: number) => {
  const x = Buffer.alloc(8);
  x.writeDoubleBE(v);
  return [...x];
};
/** A CELT 20 ms Opus packet (TOC config 31, one frame). */
const OPUS_20MS = [0xf8, 0x00, 0x00];
const block = (tick: number, frames: number[][] = [OPUS_20MS], lacing = 0) => {
  const head = [0x81, (tick >> 8) & 0xff, tick & 0xff];
  if (lacing === 0) return el(0xa3, head, [0x80], frames[0]!);
  const sizes = lacing === 1 ? frames.slice(0, -1).map((f) => f.length) : lacing === 3 ? [0x80 | frames[0]!.length, ...frames.slice(1, -1).map(() => 0xbf)] : [];
  return el(0xa3, head, [0x80 | (lacing << 1), frames.length - 1], sizes, ...frames);
};

function webmFile(o: {durationMs?: number; codec?: string; blocks: Uint8Array[]; trackNumber?: number}) {
  return cat(
    el(0x1a45dfa3, el(0x4282, text("webm"))),
    open(
      0x18538067,
      el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40]), ...(o.durationMs !== undefined ? [el(0x4489, f64(o.durationMs))] : [])),
      el(0x1654ae6b, el(0xae, el(0xd7, [o.trackNumber ?? 1]), el(0x83, [2]), el(0x86, text(o.codec ?? "A_OPUS")))),
      open(0x1f43b675, el(0xe7, [0]), ...o.blocks),
    ),
  );
}

describe("audioLength: WebM a decoder plays longer than its header says", () => {
  const seventy = Array.from({length: 3500}, (_, i) => block(i * 20));

  it("reads the frames when the header is honest", () => {
    expect(seconds(webmFile({durationMs: 70_000, blocks: seventy}))).toBeCloseTo(70, 3);
  });

  it("counts every frame, not a Duration header that says less", () => {
    expect(seconds(webmFile({durationMs: 1000, blocks: seventy}))).toBeGreaterThanOrEqual(70);
  });

  it("counts every frame, whatever the timestamps say", () => {
    expect(seconds(webmFile({blocks: Array.from({length: 3500}, () => block(0))}))).toBeGreaterThanOrEqual(70);
  });

  it("counts every laced frame (Xiph, fixed-size and EBML lacing)", () => {
    const four = [OPUS_20MS, OPUS_20MS, OPUS_20MS, OPUS_20MS];
    for (const lacing of [1, 2, 3]) expect(seconds(webmFile({blocks: [block(0, four, lacing)]}))).toBeCloseTo(0.08, 6);
  });

  it("refuses an element that runs past its parent or the end of the file", () => {
    const cluster = el(0x1f43b675, el(0xe7, [0]), block(0));
    const overrun = Buffer.from(cluster);
    overrun.writeUInt32BE(overrun.readUInt32BE(overrun.length - 4 - 8) + 1000, overrun.length - 4 - 8); // the block's size
    const file = (c: Uint8Array) => cat(el(0x1a45dfa3, el(0x4282, text("webm"))), open(0x18538067, el(0x1654ae6b, el(0xae, el(0xd7, [1]), el(0x83, [2]), el(0x86, text("A_OPUS")))), c, block(0)));
    expect(seconds(file(cluster))).toBeCloseTo(0.04, 6);
    expect(audioLength(file(new Uint8Array(overrun)))).toBeNull();
    expect(audioLength(fixture("tone.webm").subarray(0, fixture("tone.webm").length - 50))).toBeNull();
  });

  it("refuses a block for an undescribed track and another audio codec", () => {
    expect(audioLength(webmFile({trackNumber: 2, blocks: [block(0)]}))).toBeNull();
    expect(audioLength(webmFile({codec: "A_AAC", blocks: [block(0)]}))).toBeNull();
  });

  it("does not loop over a size the file declares (a 19-byte file once took years)", () => {
    const huge = cat([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x2a, 0xd7, 0xb1], [0x01, 0x3f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe], [1, 2, 3]);
    const t = Date.now();
    expect(audioLength(huge)).toBeNull();
    expect(Date.now() - t).toBeLessThan(100);
  });
});

// --- every parser, on damaged files ------------------------------------------------------------

describe("audioLength on damaged and hostile files", () => {
  /** A small seeded PRNG, so a failure reproduces. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it("never throws, never hangs, and gives null or a positive finite length", () => {
    const names = ["tone.wav", "tone.mp3", "tone.m4a", "tone-frag.m4a", "tone.ogg", "tone.webm", "tone-live.webm", "speech-4.9s.mp3"];
    const r = rng(73);
    const t = Date.now();
    for (const name of names) {
      const base = fixture(name);
      for (let k = 0; k < 250; k++) {
        const b = Buffer.from(base);
        const edits = 1 + Math.floor(r() * 8);
        for (let e = 0; e < edits; e++) {
          const at = Math.floor(r() * b.length);
          const kind = r();
          if (kind < 0.5) b[at] = Math.floor(r() * 256);
          else if (kind < 0.8) b[at] = r() < 0.5 ? 0xff : 0x01; // the bytes that make sizes huge
          else b.writeUInt32BE(Math.floor(r() * 0x100000000), Math.min(at, b.length - 4));
        }
        const cut = r() < 0.3 ? Math.floor(r() * b.length) : b.length;
        const out = audioLength(new Uint8Array(b.subarray(0, cut)));
        if (out !== null) {
          expect(Number.isFinite(out.seconds)).toBe(true);
          expect(out.seconds).toBeGreaterThan(0);
          expect(out.seconds).toBeLessThanOrEqual(AUDIO_COUNT_CEILING_SECONDS + 1);
        }
      }
    }
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it("stops counting a file of tiny frames at the ceiling and calls it long", () => {
    // 4 MB of zero-length Opus packets, each counted at the longest a packet can play
    const blocks = Array.from({length: 40_000}, () => el(0xa3, [0x81, 0, 0, 0x80]));
    expect(seconds(webmFile({blocks}))).toBe(AUDIO_COUNT_CEILING_SECONDS + 1);
  });
});
