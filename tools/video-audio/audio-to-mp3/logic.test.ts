import { describe, expect, it } from "vitest";
import {
  BITRATES,
  checkFile,
  checkProbe,
  encoderSettings,
  estimateBytes,
  formatSize,
  isAudioFile,
  isMp3File,
  LIMITS,
  MESSAGES,
  MP3_WASM_URL,
  mixDown,
  outputName,
  type Probe,
  readMp3,
} from "./logic";

const audio = { codec: "aac", sampleRate: 48000, channels: 2, decoderConfig: null };
const probe = (durationSeconds: number, withAudio = true): Probe => ({
  durationSeconds,
  audio: withAudio ? audio : null,
});

/** One MPEG-1 Layer III frame header, padded to the frame's length with zeros. */
function frame(bitrateIndex: number, rateIndex: number, mono = false, padding = 0): number[] {
  const bitrate =
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex] ?? 0;
  const rate = [44100, 48000, 32000][rateIndex] ?? 44100;
  const length = Math.floor((144000 * bitrate) / rate) + padding;
  const bytes = new Array<number>(length).fill(0);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = (bitrateIndex << 4) | (rateIndex << 2) | (padding << 1);
  bytes[3] = mono ? 0xc0 : 0x00;
  return bytes;
}

describe("the files this tool takes", () => {
  it("takes recordings by type or by extension, and nothing else", () => {
    expect(isAudioFile({ name: "a.wav", type: "audio/wav" })).toBe(true);
    expect(isAudioFile({ name: "a.FLAC", type: "" })).toBe(true);
    expect(isAudioFile({ name: "a.opus", type: "application/octet-stream" })).toBe(true);
    expect(isAudioFile({ name: "a.mp4", type: "video/mp4" })).toBe(false);
    expect(isAudioFile({ name: "a.txt", type: "" })).toBe(false);
  });

  it("refuses an MP3, which needs no conversion", () => {
    expect(isMp3File({ name: "song.mp3", type: "" })).toBe(true);
    expect(checkFile({ name: "song", type: "audio/mpeg", size: 1 })).toBe(MESSAGES.alreadyMp3);
  });

  it("takes a file of exactly 300 MB and refuses one byte more", () => {
    const at = { name: "a.wav", type: "audio/wav", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(300 * 1024 ** 2);
    expect(checkFile(at)).toBeUndefined();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe(MESSAGES.tooLarge("300 MB"));
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notAudio);
  });

  it("takes exactly two hours of sound and refuses a moment more", () => {
    expect(checkProbe(probe(2 * 3600))).toBeUndefined();
    expect(checkProbe(probe(2 * 3600 + 0.001))).toBe(MESSAGES.tooLong("2 hours"));
    expect(checkProbe(probe(10, false))).toBe(MESSAGES.noAudio);
  });
});

describe("the MP3 settings", () => {
  it("offers MPEG-1 constant bitrates only", () => {
    expect([...BITRATES]).toEqual([128, 192, 320]);
  });

  it("keeps an MPEG-1 rate and picks 44.1 or 48 kHz for any other", () => {
    expect(encoderSettings(44100, 2, 192).outputSampleRate).toBe(44100);
    expect(encoderSettings(48000, 2, 192).outputSampleRate).toBe(48000);
    expect(encoderSettings(32000, 1, 128).outputSampleRate).toBe(32000);
    expect(encoderSettings(96000, 2, 320).outputSampleRate).toBe(48000);
    expect(encoderSettings(22050, 1, 128).outputSampleRate).toBe(44100);
    expect(encoderSettings(8000, 1, 128)).toEqual({
      channels: 1,
      sampleRate: 8000,
      outputSampleRate: 44100,
      bitrate: 128,
    });
  });

  it("keeps mono and stereo, and makes stereo of more channels", () => {
    expect(encoderSettings(48000, 1, 192).channels).toBe(1);
    expect(encoderSettings(48000, 2, 192).channels).toBe(2);
    expect(encoderSettings(48000, 6, 192).channels).toBe(2);
  });

  it("mixes planes down: even planes left, odd planes right, averaged", () => {
    const a = Float32Array.of(1, 0.5);
    const b = Float32Array.of(-1, 0.5);
    const c = Float32Array.of(0, 0.25);
    expect(mixDown([a], 1)).toEqual([a]);
    expect(mixDown([a, b], 2)).toEqual([a, b]);
    expect(mixDown([a], 2)).toEqual([a, a]);
    expect(mixDown([a, b], 1)).toEqual([Float32Array.of(0, 0.5)]);
    expect(mixDown([a, b, c], 2)).toEqual([Float32Array.of(0.5, 0.375), b]);
    expect(mixDown([], 2)).toEqual([]);
  });

  it("estimates the sizes the page states for ten minutes", () => {
    expect(formatSize(estimateBytes(600, 128))).toBe("9.2 MB");
    expect(formatSize(estimateBytes(600, 192))).toBe("13.7 MB");
    expect(formatSize(estimateBytes(600, 320))).toBe("22.9 MB");
  });

  it("loads LAME from the vendored, versioned file", () => {
    expect(MP3_WASM_URL).toBe("/vendor/wasm-media-encoders/0.7.0/mp3.wasm");
  });
});

describe("reading MP3 frames", () => {
  it("counts frames, rate, channels and length", () => {
    const bytes = Uint8Array.from([...frame(11, 0), ...frame(11, 0, false, 1), ...frame(11, 0)]);
    expect(readMp3(bytes)).toEqual({
      frames: 3,
      sampleRate: 44100,
      channels: 2,
      bitrates: [192],
      durationSeconds: (3 * 1152) / 44100,
    });
    expect(readMp3(Uint8Array.from(frame(9, 1, true)))?.channels).toBe(1);
  });

  it("skips an ID3 tag and refuses bytes that are not MP3", () => {
    const tag = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0];
    expect(readMp3(Uint8Array.from([...tag, ...frame(14, 2)]))?.frames).toBe(1);
    expect(readMp3(Uint8Array.from([1, 2, 3, 4, 5]))).toBeNull();
    expect(readMp3(new Uint8Array(0))).toBeNull();
  });
});

it("names the MP3 after the recording", () => {
  expect(outputName("interview.wav")).toBe("interview.mp3");
  expect(outputName(".flac")).toBe("audio.mp3");
});
