import { describe, expect, it } from "vitest";
import {
  applyGain,
  checkFile,
  checkLength,
  checkSettings,
  joinSpans,
  keptSpans,
  LIMITS,
  MESSAGES,
  outputName,
  peakGainDb,
  wavBytes,
} from "./logic";

/** Seconds of sound: tone (amplitude 0.25) where `on`, silence elsewhere, at 1000 Hz. */
function track(parts: Array<[seconds: number, on: boolean]>): Float32Array {
  const out: number[] = [];
  for (const [seconds, on] of parts) {
    for (let i = 0; i < seconds * 1000; i++) out.push(on ? 0.25 * Math.sin(i) || 0.25 : 0);
  }
  return Float32Array.from(out);
}

describe("files and settings", () => {
  it("takes exactly 100 MB and 10 minutes, and refuses more", () => {
    const wav = { name: "a.wav", type: "audio/wav" };
    expect(checkFile({ ...wav, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...wav, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("100 MB"));
    expect(checkFile({ name: "a.mp3", type: "audio/mpeg", size: 1 })).toBe(MESSAGES.notAudio);
    expect(checkLength(600)).toBeUndefined();
    expect(checkLength(600.001)).toBe(MESSAGES.tooLong);
  });
  it("takes thresholds from -70 to -20 dB and silences from 0.3 to 10 seconds", () => {
    expect(checkSettings(-70, 0.3)).toEqual({});
    expect(checkSettings(-20, 10)).toEqual({});
    expect(Object.keys(checkSettings(-71, 10.1))).toEqual(["threshold", "minSilence"]);
    expect(Object.keys(checkSettings(-19, 0.29))).toEqual(["threshold", "minSilence"]);
  });
});

describe("keptSpans", () => {
  it("drops silence at both ends and shortens a long pause to a quarter second", () => {
    const sound = track([
      [1, false],
      [1, true],
      [2, false],
      [1, true],
      [1, false],
    ]);
    const spans = keptSpans([sound], 1000, -45, 0.5);
    expect(spans).toEqual([
      { start: 1000, end: 2125 },
      { start: 3875, end: 5000 },
    ]);
    expect(joinSpans([sound], spans)[0]?.length).toBe(2250);
  });
  it("keeps a pause shorter than the shortest silence", () => {
    const sound = track([
      [1, true],
      [0.4, false],
      [1, true],
    ]);
    expect(keptSpans([sound], 1000, -45, 0.5)).toEqual([{ start: 0, end: 2400 }]);
  });
  it("finds nothing in silence, or in sound below the threshold", () => {
    expect(keptSpans([new Float32Array(1000)], 1000, -45, 0.5)).toEqual([]);
    expect(keptSpans([Float32Array.from({ length: 1000 }, () => 0.001)], 1000, -45, 0.5)).toEqual(
      [],
    );
  });
  it("hears sound in any channel", () => {
    const quiet = new Float32Array(2000);
    const loud = track([
      [1, false],
      [1, true],
    ]);
    expect(keptSpans([quiet, loud], 1000, -45, 0.5)).toEqual([{ start: 1000, end: 2000 }]);
  });
});

describe("volume and WAV", () => {
  it("brings a peak of 0.25 to -1 dB", () => {
    const planes = [Float32Array.from([0.25, -0.1])];
    const gain = peakGainDb(planes);
    expect(gain).toBeCloseTo(-1 - 20 * Math.log10(0.25), 6);
    applyGain(planes, gain);
    expect(planes[0]?.[0]).toBeCloseTo(10 ** (-1 / 20), 6);
    expect(peakGainDb([new Float32Array(3)])).toBe(0);
  });
  it("writes a 16-bit WAV header and samples", () => {
    const bytes = wavBytes([Float32Array.from([1, -1]), Float32Array.from([0, 0.5])], 8000);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(44 + 8);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(outputName("talk.m4a", "wav")).toBe("talk-trimmed.wav");
  });
});
