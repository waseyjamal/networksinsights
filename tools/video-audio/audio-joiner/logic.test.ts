import { describe, expect, it } from "vitest";
import {
  checkClip,
  checkFile,
  LIMITS,
  MESSAGES,
  matchChannels,
  move,
  outputName,
  resample,
  resampledLength,
  targetFormat,
  tooLong,
  toPcm16,
  wavHeader,
} from "./logic";

const clip = (sampleRate: number, channels: number, durationSeconds = 1) => ({
  sampleRate,
  channels,
  durationSeconds,
  codec: "pcm-s16",
});

/** A 440 Hz sine of `seconds` at `rate`. */
const sine = (rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * 440 * i) / rate),
  );

/** Rising zero crossings per second: the frequency of a clean tone. */
const frequency = (samples: Float32Array, rate: number) => {
  let rises = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) rises++;
  }
  return rises / (samples.length / rate);
};

describe("the format of the joined file", () => {
  it("takes the highest rate and the most channels", () => {
    expect(targetFormat([clip(22_050, 1), clip(48_000, 2), clip(44_100, 1)])).toEqual({
      sampleRate: 48_000,
      channels: 2,
    });
    expect(targetFormat([clip(16_000, 1), clip(8_000, 1)])).toEqual({
      sampleRate: 16_000,
      channels: 1,
    });
  });

  it("refuses more than two channels and passes the length limit only above 20 minutes", () => {
    expect(checkClip(clip(48_000, 6))).toBe(MESSAGES.tooManyChannels(6));
    expect(checkClip(clip(48_000, 0))).toBe(MESSAGES.noAudio);
    expect(checkClip(clip(48_000, 2))).toBeUndefined();
    expect(tooLong([clip(48_000, 2, 600), clip(48_000, 2, 600)])).toBe(false);
    expect(tooLong([clip(48_000, 2, 600), clip(48_000, 2, 600.01)])).toBe(true);
  });
});

describe("resampling up", () => {
  it("keeps the length in seconds", () => {
    expect(resampledLength(22_050, 22_050, 48_000)).toBe(48_000);
    expect(resampledLength(44_100, 44_100, 48_000)).toBe(48_000);
    expect(resample(sine(22_050, 1), 22_050, 48_000)).toHaveLength(48_000);
  });

  it("keeps the pitch: a 440 Hz tone stays 440 Hz", () => {
    for (const from of [8_000, 22_050, 44_100]) {
      const out = resample(sine(from, 1), from, 48_000);
      expect(Math.abs(frequency(out, 48_000) - 440)).toBeLessThanOrEqual(1);
    }
  });

  it("stays close to the true wave, with no jumps", () => {
    const out = resample(sine(44_100, 0.5), 44_100, 48_000);
    const truth = sine(48_000, 0.5);
    let worst = 0;
    for (let i = 0; i < truth.length - 2; i++) {
      worst = Math.max(worst, Math.abs((out[i] ?? 0) - (truth[i] ?? 0)));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("returns the same samples when the rate already matches", () => {
    const samples = sine(48_000, 0.01);
    expect(resample(samples, 48_000, 48_000)).toBe(samples);
  });
});

describe("channels and samples", () => {
  it("plays mono on both channels of stereo", () => {
    const mono = Float32Array.from([0.5, -0.5]);
    const stereo = matchChannels([mono], 2);
    expect(stereo).toHaveLength(2);
    expect([...(stereo[0] ?? [])]).toEqual([0.5, -0.5]);
    expect([...(stereo[1] ?? [])]).toEqual([0.5, -0.5]);
    const kept = [Float32Array.from([1]), Float32Array.from([-1])];
    expect(matchChannels(kept, 2)).toEqual(kept);
  });

  it("writes interleaved 16-bit samples, clamped", () => {
    const pcm = toPcm16([Float32Array.from([1, -1, 2]), Float32Array.from([0, 0.5, -2])]);
    const view = new DataView(pcm.buffer);
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(i * 2, true))).toEqual([
      32767, 0, -32768, 16384, 32767, -32768,
    ]);
  });

  it("writes a WAV header", () => {
    const header = wavHeader(400, 48_000, 2);
    const view = new DataView(header.buffer);
    expect(String.fromCharCode(...header.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(436);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(192_000);
    expect(String.fromCharCode(...header.slice(36, 40))).toBe("data");
    expect(view.getUint32(40, true)).toBe(400);
  });
});

describe("files and order", () => {
  it("checks files and names the result", () => {
    expect(
      checkFile({ name: "a.wav", type: "audio/wav", size: LIMITS.maxInputBytes }),
    ).toBeUndefined();
    expect(checkFile({ name: "a.flac", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.wav", type: "audio/wav", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("200 MB"),
    );
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notAudio);
    expect(outputName("intro.mp3")).toBe("intro-joined.wav");
  });

  it("moves entries and leaves the ends in place", () => {
    expect(move(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});
