// Pure logic of Unit Converter. Every unit is an exact fraction of its group's base unit (metre,
// kilogram, square metre, litre, metre per second, byte, second), taken from the exact definitions
// in NIST SP 811 and NIST Handbook 44. The arithmetic is done on fractions of BigInts, so a result
// never carries binary floating point noise; it is rounded only once, to SIGNIFICANT digits, to show.

export type Group =
  | "length"
  | "weight"
  | "temperature"
  | "area"
  | "volume"
  | "speed"
  | "data"
  | "time";

export const GROUPS = [
  "length",
  "weight",
  "temperature",
  "area",
  "volume",
  "speed",
  "data",
  "time",
] as const satisfies readonly Group[];

export const GROUP_LABELS: Readonly<Record<Group, string>> = {
  length: "Length",
  weight: "Weight",
  temperature: "Temperature",
  area: "Area",
  volume: "Volume",
  speed: "Speed",
  data: "Data size",
  time: "Time",
};

/** The largest magnitude and the most decimal places the tool reads. */
export const MAX_VALUE = 10n ** 15n;
export const MAX_DECIMALS = 15;
/** Results are rounded to this many significant digits for display. */
export const SIGNIFICANT = 12;

export interface Unit {
  id: string;
  label: string;
  /** The size of one unit in the group's base unit, as an exact decimal or "a/b". */
  factor: string;
}

const units = (list: [string, string, string][]): Unit[] =>
  list.map(([id, label, factor]) => ({ id, label, factor }));

/** Temperature has no factor; its units are converted through kelvin. */
export const UNITS: Readonly<Record<Group, readonly Unit[]>> = {
  length: units([
    ["mm", "Millimetre (mm)", "0.001"],
    ["cm", "Centimetre (cm)", "0.01"],
    ["m", "Metre (m)", "1"],
    ["km", "Kilometre (km)", "1000"],
    ["in", "Inch (in)", "0.0254"],
    ["ft", "Foot (ft)", "0.3048"],
    ["yd", "Yard (yd)", "0.9144"],
    ["mi", "Mile (mi)", "1609.344"],
    ["nmi", "Nautical mile (nmi)", "1852"],
  ]),
  weight: units([
    ["mg", "Milligram (mg)", "0.000001"],
    ["g", "Gram (g)", "0.001"],
    ["kg", "Kilogram (kg)", "1"],
    ["t", "Tonne (t)", "1000"],
    ["oz", "Ounce (oz)", "0.028349523125"],
    ["lb", "Pound (lb)", "0.45359237"],
    ["st", "Stone (st)", "6.35029318"],
    ["ton", "US short ton", "907.18474"],
  ]),
  temperature: units([
    ["c", "Celsius (°C)", "1"],
    ["f", "Fahrenheit (°F)", "1"],
    ["k", "Kelvin (K)", "1"],
  ]),
  area: units([
    ["mm2", "Square millimetre (mm²)", "0.000001"],
    ["cm2", "Square centimetre (cm²)", "0.0001"],
    ["m2", "Square metre (m²)", "1"],
    ["ha", "Hectare (ha)", "10000"],
    ["km2", "Square kilometre (km²)", "1000000"],
    ["in2", "Square inch (in²)", "0.00064516"],
    ["ft2", "Square foot (ft²)", "0.09290304"],
    ["yd2", "Square yard (yd²)", "0.83612736"],
    ["ac", "Acre (ac)", "4046.8564224"],
    ["mi2", "Square mile (mi²)", "2589988.110336"],
  ]),
  volume: units([
    ["ml", "Millilitre (mL)", "0.001"],
    ["l", "Litre (L)", "1"],
    ["m3", "Cubic metre (m³)", "1000"],
    ["in3", "Cubic inch (in³)", "0.016387064"],
    ["ft3", "Cubic foot (ft³)", "28.316846592"],
    ["usfloz", "US fluid ounce", "0.0295735295625"],
    ["uspt", "US pint", "0.473176473"],
    ["usqt", "US quart", "0.946352946"],
    ["usgal", "US gallon", "3.785411784"],
    ["ukpt", "Imperial pint", "0.56826125"],
    ["ukgal", "Imperial gallon", "4.54609"],
  ]),
  speed: units([
    ["mps", "Metre per second (m/s)", "1"],
    ["kmh", "Kilometre per hour (km/h)", "5/18"],
    ["mph", "Mile per hour (mph)", "0.44704"],
    ["fps", "Foot per second (ft/s)", "0.3048"],
    ["kn", "Knot (kn)", "463/900"],
  ]),
  data: units([
    ["bit", "Bit", "1/8"],
    ["B", "Byte (B)", "1"],
    ["kB", "Kilobyte (kB, 1,000 bytes)", "1000"],
    ["MB", "Megabyte (MB, 1,000² bytes)", "1000000"],
    ["GB", "Gigabyte (GB, 1,000³ bytes)", "1000000000"],
    ["TB", "Terabyte (TB, 1,000⁴ bytes)", "1000000000000"],
    ["KiB", "Kibibyte (KiB, 1,024 bytes)", "1024"],
    ["MiB", "Mebibyte (MiB, 1,024² bytes)", "1048576"],
    ["GiB", "Gibibyte (GiB, 1,024³ bytes)", "1073741824"],
    ["TiB", "Tebibyte (TiB, 1,024⁴ bytes)", "1099511627776"],
  ]),
  time: units([
    ["ms", "Millisecond (ms)", "0.001"],
    ["s", "Second (s)", "1"],
    ["min", "Minute (min)", "60"],
    ["h", "Hour (h)", "3600"],
    ["d", "Day (d)", "86400"],
    ["wk", "Week", "604800"],
  ]),
};

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  group: Group;
  value: string;
  from: string;
  to: string;
}

export type Result = { ok: true; value: string; exact: boolean } | { ok: false; error: string };

/** An exact fraction n/d with d > 0. */
interface Fraction {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};

const make = (n: bigint, d: bigint): Fraction => {
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
};
const mul = (a: Fraction, b: Fraction) => make(a.n * b.n, a.d * b.d);
const div = (a: Fraction, b: Fraction) => make(a.n * b.d, a.d * b.n);
const add = (a: Fraction, b: Fraction) => make(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Fraction, b: Fraction) => add(a, { n: -b.n, d: b.d });

/** Reads "123.45", "-0.5", "1,234.5" or "a/b" into an exact fraction, or null. */
export function parseDecimal(text: string): Fraction | null {
  const t = text.trim().replace(/^\+/, "");
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split("/");
    return make(BigInt(a as string), BigInt(b as string));
  }
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
  const plain = /^-?(\d+\.?\d*|\.\d+)$/.test(t);
  if (!grouped && !plain) return null;
  const clean = t.replaceAll(",", "");
  const negative = clean.startsWith("-");
  const [whole = "", fraction = ""] = clean.replace("-", "").split(".");
  const n = BigInt(`${whole || "0"}${fraction}` || "0");
  return make(negative ? -n : n, 10n ** BigInt(fraction.length));
}

const decimalsOf = (text: string) => {
  const point = text.indexOf(".");
  return point === -1 ? 0 : text.trim().length - point - 1;
};

const KELVIN_OFFSET = make(27315n, 100n);
const NINE_FIFTHS = make(9n, 5n);
const THIRTY_TWO = make(32n, 1n);

function toKelvin(value: Fraction, unit: string): Fraction {
  if (unit === "c") return add(value, KELVIN_OFFSET);
  if (unit === "f") return add(div(sub(value, THIRTY_TWO), NINE_FIFTHS), KELVIN_OFFSET);
  return value;
}

function fromKelvin(value: Fraction, unit: string): Fraction {
  if (unit === "c") return sub(value, KELVIN_OFFSET);
  if (unit === "f") return add(mul(sub(value, KELVIN_OFFSET), NINE_FIFTHS), THIRTY_TWO);
  return value;
}

const grouping = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * An exact fraction as decimal text, rounded half away from zero to `significant` digits, with
 * grouped thousands and no trailing zeros. `exact` says whether nothing was lost.
 */
export function formatFraction(
  value: Fraction,
  significant = SIGNIFICANT,
): { text: string; exact: boolean } {
  if (value.n === 0n) return { text: "0", exact: true };
  const negative = value.n < 0n;
  const a = negative ? -value.n : value.n;
  const whole = a / value.d;
  let decimals: number;
  if (whole > 0n) {
    decimals = Math.max(0, significant - whole.toString().length);
  } else {
    let zeros = 0;
    while (a * 10n ** BigInt(zeros + 1) < value.d) zeros += 1;
    decimals = zeros + significant;
  }
  const scale = 10n ** BigInt(decimals);
  const scaled = a * scale;
  let q = scaled / value.d;
  const remainder = scaled % value.d;
  if (remainder * 2n >= value.d) q += 1n;
  const exact = remainder === 0n;
  const digits = q.toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const body = grouping(intPart) + (fracPart ? `.${fracPart}` : "");
  return { text: (negative && q !== 0n ? "-" : "") + body, exact };
}

const unitOf = (group: Group, id: string) => UNITS[group].find((unit) => unit.id === id);

/** The value converted from one unit to another, or what is wrong with the input. */
export function run(input: Input): Result {
  const from = unitOf(input.group, input.from);
  const to = unitOf(input.group, input.to);
  if (!from || !to) return { ok: false, error: "Choose two units of the same kind." };
  if (input.value.trim() === "") return { ok: false, error: "Enter a value to convert." };
  const value = parseDecimal(input.value);
  if (value === null || input.value.includes("/")) {
    return {
      ok: false,
      error: "The value is not a number. Use digits, with a decimal point if needed, such as 2.5.",
    };
  }
  if (decimalsOf(input.value) > MAX_DECIMALS) {
    return { ok: false, error: `Use at most ${MAX_DECIMALS} digits after the decimal point.` };
  }
  const magnitude = value.n < 0n ? -value.n : value.n;
  if (magnitude > MAX_VALUE * value.d) {
    return { ok: false, error: "The value is too large; the limit is 1,000,000,000,000,000." };
  }

  let out: Fraction;
  if (input.group === "temperature") {
    const kelvin = toKelvin(value, from.id);
    if (kelvin.n < 0n) {
      return { ok: false, error: "That is below absolute zero (0 K), which is not possible." };
    }
    out = fromKelvin(kelvin, to.id);
  } else {
    out = div(
      mul(value, parseDecimal(from.factor) as Fraction),
      parseDecimal(to.factor) as Fraction,
    );
  }
  const shown = formatFraction(out);
  return { ok: true, value: shown.text, exact: shown.exact };
}
