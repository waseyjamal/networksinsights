// Pure logic of "QR Code Generator": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// A QR code encoder written from the standard (ISO/IEC 18004), so the tool needs no library. The
// text becomes one segment in the smallest mode that holds all of it (numeric, alphanumeric, or
// bytes of UTF-8), in the smallest of the 40 versions that fits at the chosen error correction
// level. The data is split into blocks, each block gets its Reed-Solomon error correction bytes,
// the blocks are interleaved and placed in the matrix, and of the eight masks the one with the
// lowest penalty score is kept. No ECI header is written: readers take bytes as UTF-8 by default.

/** The four error correction levels, from the least to the most redundancy. */
export const LEVELS = ["L", "M", "Q", "H"] as const;

export type Level = (typeof LEVELS)[number];

/** Each level's label in the workspace, with the share of the code that can be lost. */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  L: "L: low, about 7% can be damaged",
  M: "M: medium, about 15% can be damaged",
  Q: "Q: quartile, about 25% can be damaged",
  H: "H: high, about 30% can be damaged",
};

export const DEFAULT_LEVEL: Level = "M";

/** The image sizes, in pixels. The image is square. */
export const SIZES = [128, 192, 256, 320, 384, 448, 512] as const;

export const MIN_SIZE = 128;
export const MAX_SIZE = 512;
export const DEFAULT_SIZE = 256;

/** The white margin around the code, in modules. The standard asks for four. */
export const QUIET_ZONE = 4;

/** The fewest pixels a module may take. At one pixel a code is too fine for most cameras. */
export const MIN_MODULE_PX = 2;

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  level: Level;
  /** The width and height of the image, in pixels, from MIN_SIZE to MAX_SIZE. */
  size: number;
}

export type Mode = "numeric" | "alphanumeric" | "byte";

/** A QR code: its modules row by row, 1 for dark and 0 for light. */
export interface QrCode {
  version: number;
  level: Level;
  mode: Mode;
  mask: number;
  /** Modules per side, 21 for version 1 up to 177 for version 40. */
  modules: number;
  /** modules × modules values, row by row. */
  dark: Uint8Array;
}

/** Where the code sits in the image: every module is `scale` pixels, starting `offset` from the edge. */
export interface Placement {
  scale: number;
  offset: number;
}

/** What the tool gives back: a code and where to draw it, or why there is none. */
export type Result =
  | { ok: true; code: QrCode; placement: Placement; size: number }
  | { ok: false; reason: "empty" | "too-long" | "too-dense" | "bad-size"; error: string };

export const MESSAGES = {
  empty: "Type some text or a link to make its QR code.",
  badSize: `Choose a size from ${MIN_SIZE} to ${MAX_SIZE} pixels.`,
} as const;

/** The characters of alphanumeric mode, in the order of their values. */
const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** The two format bits of each level. */
const LEVEL_BITS: Readonly<Record<Level, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** Error correction bytes per block, by level, then version (index 0 is unused). */
const ECC_PER_BLOCK: Readonly<Record<Level, readonly number[]>> = {
  L: [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

/** Error correction blocks, by level, then version (index 0 is unused). */
const BLOCKS: Readonly<Record<Level, readonly number[]>> = {
  L: [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
    40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/** The 4-bit mode indicator of each mode. */
const MODE_BITS: Readonly<Record<Mode, number>> = { numeric: 1, alphanumeric: 2, byte: 4 };

/** Bits of the character count, by mode, for versions 1-9, 10-26 and 27-40. */
const COUNT_BITS: Readonly<Record<Mode, readonly [number, number, number]>> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

/** Modules per side of a version. */
export function modulesOf(version: number): number {
  return version * 4 + 17;
}

/** Modules that carry data or error correction, after every function pattern and format area. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Bytes of data (without error correction) that a version holds at a level. */
export function dataCodewords(version: number, level: Level): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    (ECC_PER_BLOCK[level][version] ?? 0) * (BLOCKS[level][version] ?? 0)
  );
}

/** The smallest mode that holds every character of `text`. */
export function modeOf(text: string): Mode {
  if (/^[0-9]*$/.test(text)) return "numeric";
  for (const char of text) if (!ALPHANUMERIC.includes(char)) return "byte";
  return "alphanumeric";
}

/** Appends `length` bits of `value`, the highest first. */
function pushBits(bits: number[], value: number, length: number): void {
  for (let index = length - 1; index >= 0; index--) bits.push((value >>> index) & 1);
}

/** The segment's data bits, without the mode indicator and count, and its character count. */
function segmentBits(text: string, mode: Mode): { bits: number[]; count: number } {
  const bits: number[] = [];
  if (mode === "numeric") {
    for (let index = 0; index < text.length; index += 3) {
      const group = text.slice(index, index + 3);
      pushBits(bits, Number(group), group.length * 3 + 1);
    }
    return { bits, count: text.length };
  }
  if (mode === "alphanumeric") {
    for (let index = 0; index + 1 < text.length; index += 2)
      pushBits(
        bits,
        ALPHANUMERIC.indexOf(text.charAt(index)) * 45 +
          ALPHANUMERIC.indexOf(text.charAt(index + 1)),
        11,
      );
    if (text.length % 2 === 1)
      pushBits(bits, ALPHANUMERIC.indexOf(text.charAt(text.length - 1)), 6);
    return { bits, count: text.length };
  }
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) pushBits(bits, byte, 8);
  return { bits, count: bytes.length };
}

/** The character count's width for a mode at a version. */
function countBits(mode: Mode, version: number): number {
  return COUNT_BITS[mode][version <= 9 ? 0 : version <= 26 ? 1 : 2];
}

/** The largest character count (bytes for byte mode) a mode holds at version 40 and a level. */
export function capacity(mode: Mode, level: Level): number {
  const bits = dataCodewords(MAX_VERSION, level) * 8 - 4 - countBits(mode, MAX_VERSION);
  if (mode === "byte") return Math.floor(bits / 8);
  if (mode === "alphanumeric") return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  const rest = bits % 10;
  return Math.floor(bits / 10) * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
}

/** Multiplies two elements of GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x: number, y: number): number {
  let result = 0;
  for (let index = 7; index >= 0; index--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> index) & 1) * x;
  }
  return result;
}

/** The Reed-Solomon generator polynomial of a degree, without its leading 1, highest first. */
export function generatorPolynomial(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index++) {
    for (let term = 0; term < degree; term++) {
      result[term] = multiply(result[term] ?? 0, root) ^ (result[term + 1] ?? 0);
    }
    root = multiply(root, 2);
  }
  return result;
}

/** The Reed-Solomon error correction bytes of `data`. */
export function errorCorrection(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    for (let index = 0; index < divisor.length; index++)
      result[index] = (result[index] ?? 0) ^ multiply(divisor[index] ?? 0, factor);
  }
  return result;
}

/** The data bytes, padded to the version's capacity, then interleaved with their error correction. */
export function codewords(data: readonly number[], version: number, level: Level): number[] {
  const blocks = BLOCKS[level][version] ?? 1;
  const eccLength = ECC_PER_BLOCK[level][version] ?? 0;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = generatorPolynomial(eccLength);

  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let start = 0;
  for (let block = 0; block < blocks; block++) {
    const length = shortLength - eccLength + (block < shortBlocks ? 0 : 1);
    const part = data.slice(start, start + length);
    start += length;
    dataBlocks.push(part);
    eccBlocks.push(errorCorrection(part, divisor));
  }

  const result: number[] = [];
  for (let index = 0; index <= shortLength - eccLength; index++)
    for (const part of dataBlocks) if (index < part.length) result.push(part[index] ?? 0);
  for (let index = 0; index < eccLength; index++)
    for (const part of eccBlocks) result.push(part[index] ?? 0);
  return result;
}

/** The centres of the alignment patterns on each axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = modulesOf(version) - 7; result.length < count; position -= step)
    result.splice(1, 0, position);
  return result;
}

/** The 15 format bits of a level and a mask, with their BCH code and the standard's XOR mask. */
export function formatBits(level: Level, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rest = data;
  for (let index = 0; index < 10; index++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  return ((data << 10) | rest) ^ 0x5412;
}

/** The 18 version bits of versions 7 and up, with their BCH code. */
export function versionBits(version: number): number {
  let rest = version;
  for (let index = 0; index < 12; index++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
  return (version << 12) | rest;
}

/** Whether a mask inverts the module at column x, row y. */
function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** A matrix being built: the modules, and which of them belong to function patterns. */
interface Grid {
  size: number;
  dark: Uint8Array;
  fixed: Uint8Array;
}

function setFixed(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.dark[y * grid.size + x] = dark ? 1 : 0;
  grid.fixed[y * grid.size + x] = 1;
}

/** Writes both copies of the format bits, and the dark module. */
function drawFormat(grid: Grid, level: Level, mask: number): void {
  const bits = formatBits(level, mask);
  const bit = (index: number) => ((bits >>> index) & 1) === 1;
  const { size } = grid;
  for (let index = 0; index <= 5; index++) setFixed(grid, 8, index, bit(index));
  setFixed(grid, 8, 7, bit(6));
  setFixed(grid, 8, 8, bit(7));
  setFixed(grid, 7, 8, bit(8));
  for (let index = 9; index < 15; index++) setFixed(grid, 14 - index, 8, bit(index));
  for (let index = 0; index < 8; index++) setFixed(grid, size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index++) setFixed(grid, 8, size - 15 + index, bit(index));
  setFixed(grid, 8, size - 8, true);
}

/** Draws the finder, separator, timing and alignment patterns, and reserves the format areas. */
function drawFunctionPatterns(grid: Grid, version: number, level: Level): void {
  const { size } = grid;
  for (let index = 0; index < size; index++) {
    setFixed(grid, 6, index, index % 2 === 0);
    setFixed(grid, index, 6, index % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFixed(grid, x, y, distance !== 2 && distance !== 4);
      }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((cy, row) => {
    positions.forEach((cx, column) => {
      // The three corners hold finder patterns.
      if (
        (row === 0 && column === 0) ||
        (row === 0 && column === last) ||
        (row === last && column === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          setFixed(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormat(grid, level, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let index = 0; index < 18; index++) {
      const dark = ((bits >>> index) & 1) === 1;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      setFixed(grid, a, b, dark);
      setFixed(grid, b, a, dark);
    }
  }
}

/** Places the codewords in the zigzag order of the standard, in two-module columns from the right. */
function drawCodewords(grid: Grid, data: readonly number[]): void {
  const { size } = grid;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const at = y * size + x;
        if (grid.fixed[at] === 1 || bit >= data.length * 8) continue;
        grid.dark[at] = ((data[bit >>> 3] ?? 0) >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }
}

function applyMask(grid: Grid, mask: number): void {
  const { size } = grid;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      if (grid.fixed[at] === 0 && masked(mask, x, y)) grid.dark[at] = (grid.dark[at] ?? 0) ^ 1;
    }
}

/** The finder-like pattern dark-light-dark×3-light-dark, with four light modules on one side. */
const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
] as const;

/** The standard's penalty score of a finished matrix: the lower, the easier to read. */
export function penalty(dark: Uint8Array, size: number): number {
  const at = (x: number, y: number) => dark[y * size + x] ?? 0;
  let score = 0;
  for (const horizontal of [true, false]) {
    for (let line = 0; line < size; line++) {
      const cell = (index: number) => (horizontal ? at(index, line) : at(line, index));
      // Rule 1: five or more modules of one colour in a row.
      let run = 1;
      for (let index = 1; index <= size; index++) {
        if (index < size && cell(index) === cell(index - 1)) {
          run++;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      // Rule 3: a pattern that looks like a finder.
      for (let index = 0; index + 11 <= size; index++)
        for (const pattern of FINDER_LIKE)
          if (pattern.every((value, offset) => cell(index + offset) === value)) score += 40;
    }
  }
  // Rule 2: 2 by 2 blocks of one colour.
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const value = at(x, y);
      if (value === at(x + 1, y) && value === at(x, y + 1) && value === at(x + 1, y + 1))
        score += 3;
    }
  // Rule 4: how far the share of dark modules is from half, in steps of 5%.
  let darkCount = 0;
  for (const value of dark) darkCount += value;
  const total = size * size;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encodes `text` at `level` in the smallest version that holds it. With `mask` the code uses that
 * mask; without, the one with the lowest penalty. Null when the text does not fit in version 40.
 */
export function encode(text: string, level: Level, mask?: number): QrCode | null {
  // No mode packs more characters than numeric at level L, and a UTF-16 unit is never fewer than
  // one character or byte, so a longer text cannot fit: refuse a huge paste before encoding it.
  if (text.length > capacity("numeric", "L")) return null;
  const mode = modeOf(text);
  const segment = segmentBits(text, mode);

  let version = MIN_VERSION;
  let capacityBits = 0;
  for (; version <= MAX_VERSION; version++) {
    capacityBits = dataCodewords(version, level) * 8;
    if (4 + countBits(mode, version) + segment.bits.length <= capacityBits) break;
  }
  if (version > MAX_VERSION) return null;

  const bits: number[] = [];
  pushBits(bits, MODE_BITS[mode], 4);
  pushBits(bits, segment.count, countBits(mode, version));
  for (const value of segment.bits) bits.push(value);
  // The terminator, up to four zeros, then zeros to the byte, then the two pad bytes in turn.
  for (let index = 0; index < 4 && bits.length < capacityBits; index++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset++) byte = (byte << 1) | (bits[index + offset] ?? 0);
    data.push(byte);
  }
  for (let pad = 0xec; data.length < capacityBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const size = modulesOf(version);
  const grid: Grid = {
    size,
    dark: new Uint8Array(size * size),
    fixed: new Uint8Array(size * size),
  };
  drawFunctionPatterns(grid, version, level);
  drawCodewords(grid, codewords(data, version, level));

  let chosen = mask ?? -1;
  if (chosen < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(grid, candidate);
      drawFormat(grid, level, candidate);
      const score = penalty(grid.dark, size);
      if (score < best) {
        best = score;
        chosen = candidate;
      }
      applyMask(grid, candidate);
    }
  }
  applyMask(grid, chosen);
  drawFormat(grid, level, chosen);
  return { version, level, mode, mask: chosen, modules: size, dark: grid.dark };
}

/** Where a code of `modules` per side sits in an image of `size` pixels, or null if too fine. */
export function place(modules: number, size: number): Placement | null {
  const scale = Math.floor(size / (modules + QUIET_ZONE * 2));
  if (scale < MIN_MODULE_PX) return null;
  return { scale, offset: Math.floor((size - modules * scale) / 2) };
}

/** The smallest image size on offer that draws a code of `modules` per side. */
export function smallestSizeFor(modules: number): number | undefined {
  return SIZES.find((size) => place(modules, size) !== null);
}

export function run(input: Input): Result {
  const { text, level, size } = input;
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE)
    return { ok: false, reason: "bad-size", error: MESSAGES.badSize };
  if (text === "") return { ok: false, reason: "empty", error: MESSAGES.empty };
  const code = encode(text, level);
  if (code === null) {
    const mode = modeOf(text);
    const unit = mode === "byte" ? "bytes" : "characters";
    return {
      ok: false,
      reason: "too-long",
      error: `This text is too long for a QR code at level ${level}, which holds at most ${capacity(mode, level).toLocaleString("en-US")} ${unit} of it. Shorten the text or choose a lower level.`,
    };
  }
  const placement = place(code.modules, size);
  if (placement === null) {
    const larger = smallestSizeFor(code.modules);
    return {
      ok: false,
      reason: "too-dense",
      error: `This code has ${code.modules} modules per side, too many to draw at ${size} pixels. Choose ${larger ?? MAX_SIZE} pixels or more, shorten the text, or choose a lower level.`,
    };
  }
  return { ok: true, code, placement, size };
}
