import { describe, expect, it } from "vitest";
import {
  byteDecoder,
  checkDuration,
  checkFile,
  isOutOfMemory,
  isSilent,
  joinParts,
  joinTexts,
  LIMITS,
  logMel,
  MESSAGES,
  matches,
  melContext,
  melFilters,
  outputName,
  pickToken,
  resample,
  splitPoints,
  TOKENS,
  toHex,
  toMono,
  utf8,
  WINDOW_SAMPLES,
  windows,
} from "./logic";

describe("the model files", () => {
  it("splits and joins any buffer byte for byte", () => {
    expect(splitPoints(10, 3)).toEqual([4, 7]);
    expect(splitPoints(9, 3)).toEqual([3, 6]);
    expect(splitPoints(5, 1)).toEqual([]);
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => i * 7);
    const [a, b] = splitPoints(bytes.length, 3);
    expect(joinParts([bytes.subarray(0, a), bytes.subarray(a, b), bytes.subarray(b)])).toEqual(
      bytes,
    );
    expect(joinParts([])).toEqual(new Uint8Array(0));
  });

  it("accepts a file only with the exact size and hash", () => {
    const file = { sha256: "ab".repeat(32), bytes: 3 };
    expect(matches(file, 3, "ab".repeat(32))).toBe(true);
    expect(matches(file, 3, "AB".repeat(32))).toBe(true);
    expect(matches(file, 4, "ab".repeat(32))).toBe(false);
    expect(matches(file, 3, `${"ab".repeat(31)}ac`)).toBe(false);
    expect(toHex(Uint8Array.from([0, 15, 255]).buffer)).toBe("000fff");
  });
});

describe("files and length", () => {
  it("takes the recordings it can read and refuses others", () => {
    expect(checkFile({ name: "talk.wav", type: "audio/wav", size: 10 })).toBeNull();
    expect(checkFile({ name: "talk.mp3", type: "audio/mpeg", size: 10 })).toBeNull();
    expect(checkFile({ name: "talk.m4a", type: "", size: 10 })).toBeNull();
    expect(checkFile({ name: "notes.txt", type: "text/plain", size: 10 })).toBe(MESSAGES.notAudio);
    expect(checkFile({ name: "a.wav", type: "audio/wav", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("100 MB"),
    );
  });

  it("allows three minutes exactly and refuses anything longer", () => {
    expect(checkDuration(13)).toBeNull();
    expect(checkDuration(180)).toBeNull();
    expect(checkDuration(180.0004)).toBeNull();
    expect(checkDuration(180.001)).toBe(MESSAGES.tooLong(180.001));
    expect(checkDuration(181)).toBe(
      "This recording is 3:01 long. The limit is 3 minutes: cut it into shorter parts first.",
    );
    expect(checkDuration(0)).toBe(MESSAGES.unreadable);
    expect(checkDuration(Number.NaN)).toBe(MESSAGES.unreadable);
  });
});

describe("windows", () => {
  it("cuts 70 seconds into two full windows and a 10-second one", () => {
    expect(windows(70 * 16_000)).toEqual([
      { start: 0, end: WINDOW_SAMPLES },
      { start: WINDOW_SAMPLES, end: 2 * WINDOW_SAMPLES },
      { start: 2 * WINDOW_SAMPLES, end: 70 * 16_000 },
    ]);
  });

  it("makes six windows of three minutes, drops a tail under 0.2 s, and keeps a short recording", () => {
    expect(windows(180 * 16_000)).toHaveLength(6);
    expect(windows(60 * 16_000 + 1000)).toHaveLength(2);
    expect(windows(60 * 16_000 + 3200)).toHaveLength(3);
    expect(windows(1000)).toEqual([{ start: 0, end: 1000 }]);
    expect(windows(0)).toEqual([]);
  });

  it("finds silence by its peak", () => {
    expect(isSilent(new Float32Array(100))).toBe(true);
    expect(isSilent(Float32Array.from([0, 0.0009, -0.0009]))).toBe(true);
    expect(isSilent(Float32Array.from([0, -0.002]))).toBe(false);
  });
});

describe("sound to 16 kHz mono", () => {
  const tone = (hz: number, rate: number, seconds: number, amplitude = 0.5) =>
    Float32Array.from(
      { length: rate * seconds },
      (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
    );
  const rms = (x: Float32Array, from = 0, to = x.length) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += (x[i] ?? 0) ** 2;
    return Math.sqrt(sum / (to - from));
  };

  it("averages the channels", () => {
    expect(toMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])).toEqual(
      Float32Array.from([0.5, 0.5]),
    );
    expect(toMono([])).toEqual(new Float32Array(0));
  });

  it("keeps a 1 kHz tone at its level from 48 kHz, 44.1 kHz and 8 kHz", () => {
    for (const rate of [48_000, 44_100, 22_050, 8_000]) {
      const out = resample(tone(1000, rate, 1), rate, 16_000);
      expect(out.length, String(rate)).toBe(16_000);
      // Away from the edges, the level of a 0.5 sine: 0.5 / sqrt 2.
      expect(rms(out, 1000, 15_000), String(rate)).toBeCloseTo(0.5 / Math.SQRT2, 2);
      // The phase too: the sample at 0.25 ms after 0.5 s is the peak of the sine.
      expect(out[8004] ?? 0, String(rate)).toBeCloseTo(0.5, 1);
    }
  });

  it("removes a tone above 8 kHz instead of folding it into the speech band", () => {
    const out = resample(tone(11_000, 48_000, 1), 48_000, 16_000);
    expect(rms(out, 1000, 15_000)).toBeLessThan(0.01);
  });

  it("returns a copy when the rate is already 16 kHz", () => {
    const input = tone(440, 16_000, 1);
    const out = resample(input, 16_000, 16_000);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

describe("log-mel features", () => {
  // From librosa 0.11.0 with numpy 2.5.3 in a throwaway environment: librosa.filters.mel(sr=16000,
  // n_fft=400, n_mels=80) and librosa.stft(center=True, pad_mode="reflect", window="hann") of the
  // signal below, then Whisper's log10, clamp and scale. [mel bin, frame or FFT bin, value].
  const FILTERS = [
    [0, 1, 0.02486259490251541],
    [1, 2, 0.022871771827340126],
    [10, 12, 0],
    [40, 50, 0],
    [79, 190, 0.0022320549469441175],
    [79, 199, 0.0004487590049393475],
  ] as const;
  const POINTS = [
    [0, 0, 1.0255200862884521],
    [0, 50, -0.5617961883544922],
    [0, 99, 0.36268895864486694],
    [0, 100, 0.8750050663948059],
    [0, 101, 0.36268895864486694],
    [0, 2999, -0.5617961883544922],
    [3, 0, 1.046639084815979],
    [3, 100, 0.8961241245269775],
    [10, 0, 1.345945954322815],
    [10, 50, 1.3487379550933838],
    [10, 99, 1.3496463298797607],
    [10, 100, 1.272093415260315],
    [10, 101, 0.3800355792045593],
    [10, 150, -0.5617961883544922],
    [20, 0, 0.5353192090988159],
    [20, 99, 0.1999397873878479],
    [20, 100, 0.3848041892051697],
    [40, 0, 0.6249067783355713],
    [40, 99, -0.03366267681121826],
    [40, 100, 0.47439175844192505],
    [79, 0, 0.08437436819076538],
    [79, 99, -0.5617961883544922],
    [79, 100, -0.06614065170288086],
  ] as const;

  it("builds the same mel filters as librosa", () => {
    const filters = melFilters();
    expect(filters).toHaveLength(80);
    for (const [m, k, value] of FILTERS) expect(filters[m]?.[k] ?? -1).toBeCloseTo(value, 7);
  });

  it("matches librosa's features for one second of two tones", () => {
    const samples = Float32Array.from(
      { length: 16_000 },
      (_, n) =>
        0.5 * Math.sin((2 * Math.PI * 440 * n) / 16_000) +
        0.25 * Math.sin((2 * Math.PI * 1000 * n) / 16_000),
    );
    const features = logMel(melContext(), samples);
    expect(features).toHaveLength(80 * 3000);
    for (const [bin, frame, value] of POINTS) {
      expect(features[bin * 3000 + frame] ?? 99, `${bin},${frame}`).toBeCloseTo(value, 4);
    }
  });
});

describe("tokens", () => {
  it("maps all 256 bytes, and decodes broken UTF-8 as U+FFFD", () => {
    expect(new Set(byteDecoder().values()).size).toBe(256);
    expect(utf8([0xe2, 0x80, 0x94])).toBe("—");
    expect(utf8([0xf0, 0x9f, 0x99, 0x82])).toBe("🙂");
    expect(utf8([0xe2, 0x80])).toBe("��");
    expect(utf8([0xff, 0x41])).toBe("�A");
  });

  it("picks the most likely text token, never a timestamp or a task token", () => {
    const logits = new Float32Array(2 * 51_865).fill(-5);
    const second = 51_865;
    logits[second + 50_400] = 9; // a timestamp
    logits[second + TOKENS.english] = 8;
    logits[second + 1234] = 3;
    logits[1234 + 1] = 10; // the first row is not read
    expect(pickToken(logits, second)).toBe(1234);
    logits[second + TOKENS.endOfText] = 4;
    expect(pickToken(logits, second)).toBe(TOKENS.endOfText);
  });

  it("joins the windows' texts with one space", () => {
    expect(joinTexts([" Four score.", "", "  Now we are engaged. "])).toBe(
      "Four score. Now we are engaged.",
    );
  });
});

describe("helpers", () => {
  it("knows an out-of-memory error from others", () => {
    expect(isOutOfMemory(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(
      isOutOfMemory(
        new Error("failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc"),
      ),
    ).toBe(true);
    expect(isOutOfMemory(new Error("network"))).toBe(false);
  });

  it("names the download after the recording", () => {
    expect(outputName("talk.wav")).toBe("talk-transcript.txt");
    expect(outputName(".wav")).toBe("recording-transcript.txt");
  });
});
