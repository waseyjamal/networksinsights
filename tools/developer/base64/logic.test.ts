import { describe, expect, it } from "vitest";
import {
  asText,
  checkFileSize,
  decode,
  encode,
  encodeBytes,
  formatSize,
  kindOf,
  MAX_BYTES,
  type Result,
  run,
} from "./logic";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

/** The decoded result, or a failure that names the reason. */
function decoded(input: string) {
  const result = decode(input);
  if (!result.ok || result.mode !== "decode")
    throw new Error(`not decoded: ${JSON.stringify(result)}`);
  return result;
}

/** Base64 the slow, obvious way: the bits as a string of 0 and 1, cut into sixes (RFC 4648, section 4). */
function reference(data: Uint8Array, variant: "standard" | "url"): string {
  const alphabet = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789${variant === "url" ? "-_" : "+/"}`;
  const bits = Array.from(data, (value) => value.toString(2).padStart(8, "0")).join("");
  let out = "";
  for (let i = 0; i < bits.length; i += 6) {
    out += alphabet.charAt(Number.parseInt(bits.slice(i, i + 6).padEnd(6, "0"), 2));
  }
  return variant === "url" ? out : out.padEnd(Math.ceil(out.length / 4) * 4, "=");
}

function error(result: Result): string {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("encode", () => {
  // RFC 4648, section 10.
  const vectors: Array<[string, string]> = [
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  it("gives the test vectors of RFC 4648", () => {
    for (const [input, output] of vectors) expect(encode(text(input), "standard")).toBe(output);
  });

  it("leaves the padding out of Base64URL", () => {
    for (const [input, output] of vectors) {
      expect(encode(text(input), "url")).toBe(output.replaceAll("=", ""));
    }
  });

  it("uses - and _ in Base64URL where standard Base64 uses + and /", () => {
    expect(encode(bytes(0xfb, 0xff, 0xbf), "standard")).toBe("+/+/");
    expect(encode(bytes(0xfb, 0xff, 0xbf), "url")).toBe("-_-_");
  });

  it("encodes text as UTF-8", () => {
    const result = run({ mode: "encode", variant: "standard", text: "héllo ✓ 😀" });
    expect(result).toEqual({
      ok: true,
      mode: "encode",
      output: "aMOpbGxvIOKckyDwn5iA",
      inputBytes: 15,
    });
  });

  it("matches a bit-by-bit reference for every length up to 300 bytes", () => {
    for (let length = 0; length < 300; length++) {
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i++) data[i] = (i * 37 + length * 11) & 255;
      expect(encode(data, "standard")).toBe(reference(data, "standard"));
      expect(encode(data, "url")).toBe(reference(data, "url"));
    }
  });

  it("asks for text when there is none", () => {
    expect(run({ mode: "encode", variant: "standard", text: "" })).toEqual({
      ok: false,
      reason: "empty",
      error: "Type or paste text to encode.",
    });
  });

  it(`encodes up to ${MAX_BYTES} bytes and refuses one more`, () => {
    const atLimit = encodeBytes(new Uint8Array(MAX_BYTES), "standard");
    expect(atLimit.ok && atLimit.mode === "encode" && atLimit.output.length).toBe(
      Math.ceil(MAX_BYTES / 3) * 4,
    );
    expect(encodeBytes(new Uint8Array(MAX_BYTES + 1), "standard")).toEqual({
      ok: false,
      reason: "too-large",
      error: "This is just over 5 MB, the most the tool works on.",
    });
  });

  it("checks a file's size before it is read", () => {
    expect(checkFileSize(MAX_BYTES)).toBeNull();
    expect(checkFileSize(8 * 1024 * 1024)).toBe(
      "This is 8 MB, more than the 5 MB the tool works on.",
    );
  });
});

describe("decode", () => {
  it("decodes standard Base64 to text", () => {
    const result = decoded("SGVsbG8sIHdvcmxkIQ==");
    expect(result.text).toBe("Hello, world!");
    expect(result.kind).toEqual({ extension: "txt", label: "Text" });
    expect(result.inputCharacters).toBe(20);
  });

  it("decodes UTF-8 text", () => {
    expect(decoded("aMOpbGxvIOKckyDwn5iA").text).toBe("héllo ✓ 😀");
  });

  it("reads Base64URL, and padding is optional in both alphabets", () => {
    expect(Array.from(decoded("-_-_").bytes)).toEqual([0xfb, 0xff, 0xbf]);
    expect(decoded("Zm9vYg").text).toBe("foob");
    expect(decoded("Zm9vYg==").text).toBe("foob");
    expect(decoded("Zm9vYmE").text).toBe("fooba");
  });

  it("ignores spaces, tabs and line breaks anywhere", () => {
    const wrapped = ["  Zm9v", "YmFy ", "", "Zg ==  "].join(String.fromCharCode(13, 10));
    expect(decoded(`${String.fromCharCode(9)}${wrapped}`).text).toBe("foobarf");
  });

  it("round-trips every byte value", () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    for (const variant of ["standard", "url"] as const) {
      expect(Array.from(decoded(encode(data, variant)).bytes)).toEqual(Array.from(data));
    }
  });

  it("decodes a data: URL from after its comma", () => {
    const result = decoded("data:text/plain;charset=utf-8;base64,aGk=");
    expect(result.text).toBe("hi");
    expect(error(decode("data:text/plain,hi"))).toBe(
      'This data: URL is not Base64: its header has no ";base64" before the ",".',
    );
    expect(error(decode("data:image/png;base64"))).toBe(
      'This data: URL has no "," before its data.',
    );
  });

  it("says when the result is a file and guesses its type", () => {
    const png = decoded(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );
    expect(png.text).toBeNull();
    expect(png.kind).toEqual({ extension: "png", label: "PNG image" });
    expect(
      decoded(
        encode(
          bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3),
          "standard",
        ),
      ).kind.extension,
    ).toBe("pdf");
    expect(decoded(encode(bytes(0, 1, 2, 3, 250), "standard")).kind).toEqual({
      extension: "bin",
      label: "Binary data",
    });
  });

  it("asks for Base64 when there is none", () => {
    expect(decode("")).toEqual({ ok: false, reason: "empty", error: "Paste Base64 to decode." });
    expect(decode("  ").ok).toBe(false);
  });

  it("names the character that is not Base64 and where it is", () => {
    expect(error(decode("Zm9v*mFy"))).toBe(
      'Character 5, "*", is not Base64. Base64 uses A to Z, a to z, 0 to 9, + and / (or - and _ in Base64URL), and = at the end.',
    );
    expect(error(decode("Zm9v😀"))).toContain('Character 5, "😀", is not Base64.');
    expect(error(decode(`Zm9v${String.fromCharCode(0)}`))).toContain(
      "Character 5, a control character (U+0000), is not Base64.",
    );
  });

  it("refuses a mix of the two alphabets", () => {
    expect(error(decode("ab+c-d_A"))).toBe(
      'This mixes the two alphabets: "+" at character 3 and "-" at character 5. Standard Base64 uses + and /, Base64URL uses - and _.',
    );
  });

  it("refuses padding before the end", () => {
    expect(error(decode("Zg==Zm8="))).toBe(
      'Character 3 is "=" but more Base64 follows it. Padding may only come at the end.',
    );
  });

  it("refuses wrong padding and a cut-short last group", () => {
    expect(error(decode("Zg="))).toBe(
      'The padding is wrong: 1 "=" after 2 characters. With padding, the length must be a multiple of four.',
    );
    expect(error(decode("Zm9v="))).toContain("The padding is wrong");
    expect(error(decode("Zm9vY"))).toContain("The Base64 is cut short");
    expect(error(decode("===="))).toBe(
      'There is only padding ("=") here, and no Base64 before it.',
    );
  });

  it(`gives back up to ${MAX_BYTES} bytes and refuses more`, () => {
    expect(decoded(encode(new Uint8Array(MAX_BYTES), "standard")).bytes.length).toBe(MAX_BYTES);
    const over = decode(encode(new Uint8Array(MAX_BYTES + 3), "standard"));
    expect(over).toMatchObject({ ok: false, reason: "too-large" });
  });
});

describe("asText", () => {
  it("keeps tabs and line breaks, and refuses other control characters and invalid UTF-8", () => {
    expect(asText(text(`a${String.fromCharCode(9, 10, 13)}b`))).toBe(
      `a${String.fromCharCode(9, 10, 13)}b`,
    );
    expect(asText(bytes(0x61, 0x00))).toBeNull();
    expect(asText(bytes(0x61, 0x7f))).toBeNull();
    expect(asText(bytes(0xc3, 0x28))).toBeNull();
    expect(asText(bytes(0xff, 0xfe))).toBeNull();
  });
});

describe("kindOf", () => {
  it("knows the common signatures", () => {
    expect(kindOf(bytes(0xff, 0xd8, 0xff, 0xe0)).extension).toBe("jpg");
    expect(kindOf(text("GIF89a")).extension).toBe("gif");
    expect(kindOf(bytes(0x50, 0x4b, 0x03, 0x04)).extension).toBe("zip");
    expect(kindOf(text("RIFF....WEBPVP8 ")).extension).toBe("webp");
    expect(kindOf(text("RIFF....WAVE")).extension).toBe("bin");
    expect(kindOf(bytes()).extension).toBe("bin");
  });
});

describe("formatSize", () => {
  it("says sizes as a reader does", () => {
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(512)).toBe("512 bytes");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(MAX_BYTES)).toBe("5 MB");
  });
});
