import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkProbe,
  formatSize,
  isAudioFile,
  LIMITS,
  MESSAGES,
  outputChoices,
  outputName,
  type Probe,
  type Support,
} from "./logic";

const probe = (codec: string | null, durationSeconds = 3): Probe => ({
  durationSeconds,
  codec,
  sampleRate: 48_000,
  channels: 2,
  decoderConfig: null,
});

const all: Support = { decode: true, encodeOpus: true, encodeAac: true, wasm: true };
const firefox: Support = { ...all, encodeAac: false };
const none: Support = { decode: false, encodeOpus: false, encodeAac: false, wasm: true };
const available = (choices: ReturnType<typeof outputChoices>) =>
  choices.filter((choice) => choice.available).map((choice) => choice.kind);

describe("files", () => {
  it("takes audio by media type, or by extension when the type is missing", () => {
    expect(isAudioFile({ name: "a.wav", type: "audio/wav" })).toBe(true);
    expect(isAudioFile({ name: "a.flac", type: "" })).toBe(true);
    expect(isAudioFile({ name: "a.opus", type: "application/octet-stream" })).toBe(true);
    expect(isAudioFile({ name: "a.mp3", type: "audio/mpeg" })).toBe(false);
    expect(isAudioFile({ name: "a.mp3", type: "" })).toBe(false);
    expect(isAudioFile({ name: "a.wav", type: "text/plain" })).toBe(false);
  });

  it("accepts a file of exactly 300 MB and refuses one byte more", () => {
    const at = { name: "a.wav", type: "audio/wav", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(300 * 1024 * 1024);
    expect(checkFile(at)).toBeUndefined();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe("This file is larger than 300 MB.");
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notAudio);
  });
});

describe("length", () => {
  it("accepts exactly two hours and refuses anything longer", () => {
    expect(checkProbe(probe("aac", LIMITS.maxDurationSeconds))).toBeUndefined();
    expect(checkProbe(probe("aac", LIMITS.maxDurationSeconds + 0.001))).toBe(
      "This recording is longer than 2 hours.",
    );
  });

  it("offers WAV and FLAC up to exactly 30 minutes, and not one moment more", () => {
    expect(available(outputChoices(probe("aac", LIMITS.maxLosslessSeconds), all))).toEqual([
      "wav",
      "flac",
      "ogg",
      "m4a",
    ]);
    const over = outputChoices(probe("aac", LIMITS.maxLosslessSeconds + 0.001), all);
    expect(available(over)).toEqual(["ogg", "m4a"]);
    expect(over[0]?.reason).toBe(MESSAGES.losslessTooLong("30 minutes"));
  });
});

describe("outputs", () => {
  it("offers everything where the browser decodes and encodes both codecs", () => {
    expect(available(outputChoices(probe("opus"), all))).toEqual(["wav", "flac", "ogg", "m4a"]);
  });

  it("leaves M4A out in a browser with no AAC encoder, with the reason", () => {
    const choices = outputChoices(probe("opus"), firefox);
    expect(available(choices)).toEqual(["wav", "flac", "ogg"]);
    expect(choices[3]?.reason).toBe(MESSAGES.noAac);
  });

  it("converts WAV to WAV and FLAC with no codec at all", () => {
    expect(available(outputChoices(probe("pcm-s16"), none))).toEqual(["wav", "flac"]);
    expect(outputChoices(probe("pcm-s16"), none)[2]?.reason).toBe(MESSAGES.noOpus);
  });

  it("copies the same codec without a decoder, and offers nothing else", () => {
    const choices = outputChoices(probe("aac"), none);
    expect(available(choices)).toEqual(["m4a"]);
    expect(choices[3]?.copy).toBe(true);
    expect(choices[0]?.reason).toBe(MESSAGES.cannotDecode);
    expect(available(outputChoices(probe("opus"), none))).toEqual(["ogg"]);
    expect(available(outputChoices(probe("flac"), none))).toEqual([]);
  });

  it("needs WebAssembly for FLAC", () => {
    const choices = outputChoices(probe("pcm-s16"), { ...all, wasm: false });
    expect(choices[1]?.reason).toBe(MESSAGES.noWasm);
  });

  it("names the output after the file, and marks a same-format copy", () => {
    expect(outputName("song.wav", "flac")).toBe("song.flac");
    expect(outputName("memo.m4a", "m4a")).toBe("memo-converted.m4a");
    expect(outputName("a.b.ogg", "wav")).toBe("a.b.wav");
    expect(formatSize(300 * 1024 * 1024)).toBe("300 MB");
  });
});
