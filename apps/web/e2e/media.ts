import { expect, type Page, type TestInfo } from "@playwright/test";

// Readers for the files the video and audio tools write, so their specs check the real result:
// the container's own header, its codecs and its length, read in Node from the downloaded bytes.
// Each reader is small and only as complete as the files these tools write need.

export interface MediaFacts {
  container: "mp4" | "wav" | "flac" | "ogg" | "webm" | "gif";
  /** Length in seconds, from the container's own header (or summed frame delays for a GIF). */
  durationSeconds: number;
  /** Sample entry or codec names found: "avc1", "mp4a", "Opus", "V_VP9", "A_OPUS", "fLaC", "pcm". */
  codecs: string[];
  width?: number | undefined;
  height?: number | undefined;
  sampleRate?: number | undefined;
  channels?: number | undefined;
  frames?: number | undefined;
}

const ascii = (bytes: Buffer, at: number, length: number) =>
  bytes.toString("latin1", at, at + length);

/** The boxes of an ISO BMFF file, depth first, with their offsets. */
function* boxes(bytes: Buffer, start = 0, end = bytes.length): Generator<[string, number, number]> {
  let at = start;
  while (at + 8 <= end) {
    let size = bytes.readUInt32BE(at);
    const type = ascii(bytes, at + 4, 4);
    let header = 8;
    if (size === 1) {
      size = Number(bytes.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) return;
    yield [type, at + header, at + size];
    if (["moov", "trak", "mdia", "minf", "stbl"].includes(type))
      yield* boxes(bytes, at + header, at + size);
    if (type === "stsd") yield* boxes(bytes, at + header + 8, at + size);
    at += size;
  }
}

function readMp4(bytes: Buffer): MediaFacts {
  let durationSeconds = Number.NaN;
  const codecs: string[] = [];
  let width: number | undefined;
  let height: number | undefined;
  for (const [type, body] of boxes(bytes)) {
    if (type === "mvhd") {
      const version = bytes[body] ?? 0;
      const timescale = bytes.readUInt32BE(body + (version === 1 ? 20 : 12));
      const duration =
        version === 1 ? Number(bytes.readBigUInt64BE(body + 24)) : bytes.readUInt32BE(body + 16);
      durationSeconds = duration / timescale;
    } else if (["avc1", "avc3", "hvc1", "vp09", "av01"].includes(type)) {
      codecs.push(type);
      width = bytes.readUInt16BE(body + 24);
      height = bytes.readUInt16BE(body + 26);
    } else if (["mp4a", "Opus", "fLaC", "ipcm"].includes(type)) codecs.push(type);
  }
  return { container: "mp4", durationSeconds, codecs, width, height };
}

function readWav(bytes: Buffer): MediaFacts {
  let at = 12;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let dataBytes = 0;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = bytes.readUInt16LE(at + 10);
      sampleRate = bytes.readUInt32LE(at + 12);
      blockAlign = bytes.readUInt16LE(at + 20);
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.length - at - 8);
      break;
    }
    at += 8 + size + (size % 2);
  }
  return {
    container: "wav",
    codecs: ["pcm"],
    channels,
    sampleRate,
    durationSeconds: dataBytes / blockAlign / sampleRate,
  };
}

function readFlac(bytes: Buffer): MediaFacts {
  // STREAMINFO is the first metadata block: 4 bytes of block header after "fLaC".
  const info = 8;
  const sampleRate = (bytes.readUInt32BE(info + 10) >>> 12) & 0xfffff;
  const channels = ((bytes[info + 12] ?? 0) >> 1) & 0x7;
  const high = (bytes[info + 13] ?? 0) & 0x0f;
  const total = high * 2 ** 32 + bytes.readUInt32BE(info + 14);
  return {
    container: "flac",
    codecs: ["fLaC"],
    sampleRate,
    channels: channels + 1,
    durationSeconds: total / sampleRate,
  };
}

function readOgg(bytes: Buffer): MediaFacts {
  const codecs: string[] = [];
  if (bytes.includes("OpusHead")) codecs.push("Opus");
  if (bytes.includes(`${String.fromCharCode(1)}vorbis`)) codecs.push("Vorbis");
  const head = bytes.indexOf("OpusHead");
  const preSkip = head >= 0 ? bytes.readUInt16LE(head + 10) : 0;
  const channels = head >= 0 ? bytes[head + 9] : undefined;
  // The granule position of the last page is the number of 48 kHz samples, pre-skip included.
  const last = bytes.lastIndexOf("OggS");
  const granule = Number(bytes.readBigInt64LE(last + 6));
  return {
    container: "ogg",
    codecs,
    channels,
    sampleRate: 48_000,
    durationSeconds: (granule - preSkip) / 48_000,
  };
}

function readWebm(bytes: Buffer): MediaFacts {
  const codecs = ["V_VP8", "V_VP9", "V_AV1", "A_OPUS", "A_VORBIS"].filter((id) =>
    bytes.includes(id),
  );
  // TimestampScale (0x2AD7B1, nanoseconds per tick, default 1 ms) and Duration (0x4489, a float).
  let scale = 1_000_000;
  const scaleAt = bytes.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (scaleAt >= 0) {
    const length = (bytes[scaleAt + 3] ?? 0x80) & 0x7f;
    scale = bytes.readUIntBE(scaleAt + 4, length);
  }
  let durationSeconds = Number.NaN;
  const durationAt = bytes.indexOf(Buffer.from([0x44, 0x89]));
  if (durationAt >= 0) {
    const length = (bytes[durationAt + 2] ?? 0x80) & 0x7f;
    const ticks =
      length === 8 ? bytes.readDoubleBE(durationAt + 3) : bytes.readFloatBE(durationAt + 3);
    durationSeconds = (ticks * scale) / 1e9;
  }
  return { container: "webm", codecs, durationSeconds };
}

function readGif(bytes: Buffer): MediaFacts {
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let at = 13;
  const packed = bytes[10] ?? 0;
  if (packed & 0x80) at += 3 * 2 ** ((packed & 0x07) + 1);
  let frames = 0;
  let centiseconds = 0;
  const skipSubBlocks = (from: number) => {
    let p = from;
    while ((bytes[p] ?? 0) !== 0) p += (bytes[p] ?? 0) + 1;
    return p + 1;
  };
  while (at < bytes.length) {
    const marker = bytes[at];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (bytes[at + 1] === 0xf9) centiseconds += bytes.readUInt16LE(at + 4);
      at = skipSubBlocks(at + 2);
    } else if (marker === 0x2c) {
      frames++;
      const local = bytes[at + 9] ?? 0;
      at += 10;
      if (local & 0x80) at += 3 * 2 ** ((local & 0x07) + 1);
      at = skipSubBlocks(at + 1);
    } else break;
  }
  return {
    container: "gif",
    codecs: ["gif"],
    width,
    height,
    frames,
    durationSeconds: centiseconds / 100,
  };
}

/** Reads a file these tools write, by its magic number. Throws on anything else. */
export function readMedia(bytes: Buffer): MediaFacts {
  if (ascii(bytes, 4, 4) === "ftyp") return readMp4(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return readWav(bytes);
  if (ascii(bytes, 0, 4) === "fLaC") return readFlac(bytes);
  if (ascii(bytes, 0, 4) === "OggS") return readOgg(bytes);
  if (bytes.readUInt32BE(0) === 0x1a45dfa3) return readWebm(bytes);
  if (ascii(bytes, 0, 6) === "GIF89a" || ascii(bytes, 0, 6) === "GIF87a") return readGif(bytes);
  throw new Error(`Not a media file this reader knows: ${bytes.subarray(0, 12).toString("hex")}`);
}

/** A WAV file of a sine tone, 16-bit PCM, made in the test. */
export function sineWav(seconds: number, sampleRate = 48_000, channels = 2): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12_000);
    for (let c = 0; c < channels; c++) data.writeInt16LE(value, (i * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** What a browser really decodes and encodes, asked with WebCodecs in the page. */
export interface BrowserCodecs {
  decodeAvc: boolean;
  decodeVp9: boolean;
  decodeAac: boolean;
  decodeOpus: boolean;
  encodeAvc: boolean;
  encodeVp9: boolean;
  encodeAac: boolean;
  encodeOpus: boolean;
  offscreenCanvas: boolean;
}

/** Asks the browser itself, independently of the page under test, what it can do. */
export function browserCodecs(page: Page): Promise<BrowserCodecs> {
  return page.evaluate(async () => {
    const ask = async (run: () => Promise<{ supported?: boolean }>) => {
      try {
        return (await run()).supported === true;
      } catch {
        return false;
      }
    };
    const audio = { sampleRate: 48_000, numberOfChannels: 2 };
    const picture = { width: 320, height: 240, bitrate: 1_000_000 };
    const vd = typeof VideoDecoder !== "undefined";
    const ve = typeof VideoEncoder !== "undefined";
    const ad = typeof AudioDecoder !== "undefined";
    const ae = typeof AudioEncoder !== "undefined";
    return {
      decodeAvc: vd && (await ask(() => VideoDecoder.isConfigSupported({ codec: "avc1.42c00d" }))),
      decodeVp9:
        vd && (await ask(() => VideoDecoder.isConfigSupported({ codec: "vp09.00.10.08" }))),
      decodeAac:
        ad && (await ask(() => AudioDecoder.isConfigSupported({ codec: "mp4a.40.2", ...audio }))),
      decodeOpus:
        ad && (await ask(() => AudioDecoder.isConfigSupported({ codec: "opus", ...audio }))),
      encodeAvc:
        ve &&
        (await ask(() => VideoEncoder.isConfigSupported({ codec: "avc1.42c01e", ...picture }))),
      encodeVp9:
        ve &&
        (await ask(() => VideoEncoder.isConfigSupported({ codec: "vp09.00.10.08", ...picture }))),
      encodeAac:
        ae &&
        (await ask(() =>
          AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", ...audio, bitrate: 128_000 }),
        )),
      encodeOpus:
        ae &&
        (await ask(() =>
          AudioEncoder.isConfigSupported({ codec: "opus", ...audio, bitrate: 128_000 }),
        )),
      offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    };
  });
}

/** Removes WebCodecs classes from the page before it loads, as a browser without them would be. */
export async function hideFromPage(page: Page, names: string[]) {
  await page.addInitScript((hidden: string[]) => {
    for (const name of hidden) Reflect.deleteProperty(globalThis, name);
  }, names);
}

/** The label each path gets in the report. */
export const PATH_LABELS = { real: "real conversion", message: "message path only" } as const;

/**
 * Records which path a test took in this browser, for the report: "real conversion" when it made a
 * file and read it back, "message path only" when it checked only what the page says (a browser
 * that cannot convert, or a test that converts nothing). Every media test records at least one.
 */
export function recordPath(testInfo: TestInfo, what: string, path: "real" | "message") {
  testInfo.annotations.push({ type: "path", description: `${PATH_LABELS[path]}: ${what}` });
}

/**
 * Guards the capability probe the tests branch on: wherever this browser has a WebCodecs class,
 * it must support at least one common codec. A probe that is wrong for every codec (a bad codec
 * string, a broken API) would otherwise send every browser down the message path and let the
 * tests pass without one real conversion. A browser without the class (WebKit on Windows) is
 * genuinely unable, and passes.
 */
export async function expectProbeSane(page: Page) {
  const broken = await page.evaluate(async () => {
    const supported = async (run: () => Promise<{ supported?: boolean }>) => {
      try {
        return (await run()).supported === true;
      } catch {
        return false;
      }
    };
    const picture = { width: 320, height: 240, bitrate: 1_000_000 };
    const video = ["avc1.42c01e", "vp8", "vp09.00.10.08", "av01.0.04M.08"];
    const sound = { sampleRate: 48_000, numberOfChannels: 2 };
    const audio = ["opus", "mp4a.40.2", "flac", "pcm-s16"];
    const any = async (codecs: string[], ask: (codec: string) => Promise<boolean>) => {
      for (const codec of codecs) if (await ask(codec)) return true;
      return false;
    };
    const failing: string[] = [];
    if (typeof VideoDecoder !== "undefined") {
      if (
        !(await any(video, (codec) => supported(() => VideoDecoder.isConfigSupported({ codec }))))
      )
        failing.push("VideoDecoder");
    }
    if (typeof VideoEncoder !== "undefined") {
      const ok = await any(video, (codec) =>
        supported(() => VideoEncoder.isConfigSupported({ codec, ...picture })),
      );
      if (!ok) failing.push("VideoEncoder");
    }
    if (typeof AudioDecoder !== "undefined") {
      const ok = await any(audio, (codec) =>
        supported(() => AudioDecoder.isConfigSupported({ codec, ...sound })),
      );
      if (!ok) failing.push("AudioDecoder");
    }
    if (typeof AudioEncoder !== "undefined") {
      const ok = await any(audio, (codec) =>
        supported(() => AudioEncoder.isConfigSupported({ codec, ...sound, bitrate: 128_000 })),
      );
      if (!ok) failing.push("AudioEncoder");
    }
    return failing;
  });
  expect(broken, "a WebCodecs class that supports no common codec").toEqual([]);
}
