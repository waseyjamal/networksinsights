// @ts-expect-error: imagetracerjs ships no type declarations.
import ImageTracer from "imagetracerjs";
import { describe, expect, it } from "vitest";
import {
  checkFile,
  isSafeSvg,
  LIMITS,
  MESSAGES,
  outputName,
  type TraceData,
  toSvg,
  tracerOptions,
  traceSize,
} from "./logic";

/** A white picture with a red square in the middle. */
function redSquare(size = 40, from = 10, to = 30) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const red = x >= from && x < to && y >= from && y < to;
      data.set(red ? [255, 0, 0, 255] : [255, 255, 255, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

const trace = (preset: "2" | "4" | "8" | "16" = "2"): TraceData =>
  ImageTracer.imagedataToTracedata(redSquare(), tracerOptions(preset));

describe("checkFile and traceSize", () => {
  it("accepts JPG, PNG and WebP, and refuses other files and large ones", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBeNull();
    expect(checkFile({ name: "a.JPG", type: "", size: 1 })).toBeNull();
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.type);
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooBig("30 MB"),
    );
  });

  it("keeps a picture of 2 megapixels or less at its size", () => {
    expect(traceSize(1000, 2000)).toEqual({ width: 1000, height: 2000, scaled: false });
  });

  it("scales a larger picture to about 2 megapixels and keeps its shape", () => {
    const size = traceSize(4000, 3000);
    expect(size.scaled).toBe(true);
    expect(size.width * size.height).toBeLessThanOrEqual(LIMITS.tracePixels);
    expect(size.width * size.height).toBeGreaterThan(LIMITS.tracePixels * 0.99);
    expect(size.width / size.height).toBeCloseTo(4 / 3, 2);
  });
});

describe("toSvg", () => {
  it("traces a red square on white into a safe SVG with a red path", () => {
    const { svg, paths } = toSvg(trace());
    expect(isSafeSvg(svg)).toBe(true);
    expect(paths).toBeGreaterThanOrEqual(2);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"')).toBe(
      true,
    );
    const fills = [...svg.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) =>
      m.slice(1, 4).map(Number),
    );
    expect(fills.some(([r = 0, g = 255, b = 255]) => r > 239 && g < 16 && b < 16)).toBe(true);
  });

  it("gives the same SVG for the same picture", () => {
    expect(toSvg(trace("8")).svg).toBe(toSvg(trace("8")).svg);
  });

  it("leaves out transparent colours and writes the opacity of see-through ones", () => {
    const data: TraceData = {
      width: 2,
      height: 2,
      palette: [
        { r: 0, g: 0, b: 0, a: 0 },
        { r: 10, g: 20, b: 30, a: 128 },
      ],
      layers: [
        [
          {
            segments: [{ type: "L", x1: 0, y1: 0, x2: 1, y2: 0 }],
            holechildren: [],
            isholepath: false,
          },
        ],
        [
          {
            segments: [{ type: "L", x1: 0, y1: 0, x2: 2, y2: 0 }],
            holechildren: [],
            isholepath: false,
          },
        ],
      ],
    };
    const { svg, paths } = toSvg(data);
    expect(paths).toBe(1);
    expect(svg).toContain('fill="rgb(10,20,30)"');
    expect(svg).toContain('fill-opacity="0.5"');
    expect(isSafeSvg(svg)).toBe(true);
  });
});

describe("isSafeSvg", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1">';
  const path = '<path fill="rgb(1,2,3)" d="M 0 0 L 1 1 Z"/>';

  it("accepts an svg of paths", () => {
    expect(isSafeSvg(`${ok}\n${path}\n</svg>`)).toBe(true);
  });

  it.each([
    ["a script", `${ok}<script>alert(1)</script></svg>`],
    ["an event handler", `${ok}<path onload="alert(1)" d="M 0 0 Z"/></svg>`],
    ["a link", `${ok}<a href="https://example.com">${path}</a></svg>`],
    ["an external image", `${ok}<image href="https://example.com/a.png"/></svg>`],
    ["a style", `${ok}<style>@import url(https://example.com/a.css)</style></svg>`],
    ["a url() fill", `${ok}<path fill="url(https://example.com/#a)" d="M 0 0 Z"/></svg>`],
    ["foreignObject", `${ok}<foreignObject><div/></foreignObject></svg>`],
    ["a doctype", `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${ok}</svg>`],
    ["a comment", `${ok}<!-- x --></svg>`],
    ["text outside tags", `${ok}hello</svg>`],
    ["two roots", `${ok}</svg>${ok}</svg>`],
    ["an unclosed root", `${ok}${path}`],
    [
      "an xlink namespace",
      `${ok.replace(">", ' xmlns:xlink="http://www.w3.org/1999/xlink">')}</svg>`,
    ],
  ])("refuses %s", (_name, svg) => {
    expect(isSafeSvg(svg)).toBe(false);
  });
});

it("names the SVG after the image", () => {
  expect(outputName("logo.png")).toBe("logo.svg");
});
