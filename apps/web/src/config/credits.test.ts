import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIBHEIF_ASSETS } from "../../../../tools/image/heic-to-jpg/logic";
import {
  PDFJS_ASSETS as OCR_PDFJS_ASSETS,
  TESSERACT_ASSETS,
} from "../../../../tools/image/ocr/logic";
import { PDFJS_ASSETS } from "../../../../tools/pdf/pdf-to-jpg/logic";
import { credits, LIBFLAC_NOTICE, ZLIB_NOTICE } from "./credits";
import { LIBHEIF_BASE, LIBHEIF_FILES, LIBHEIF_VERSION } from "./libheif";
import { PDFJS_BASE, PDFJS_VENDOR_FOLDERS, PDFJS_VERSION } from "./pdfjs";
import { TESSERACT_BASE, TESSERACT_FILES, TESSERACT_VERSION } from "./tesseract";

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const toolsPackage = JSON.parse(readFileSync(join(repo, "tools", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const installed = (name: string) => join(repo, "tools", "node_modules", name);

describe("credits", () => {
  it("credits every library the tools ship, at the version installed", () => {
    const version = (name: string) => credits.find((credit) => credit.name.includes(name))?.version;
    expect(version("pdf-lib")).toBe(toolsPackage.dependencies["pdf-lib"]);
    expect(version("pdfjs-dist")).toBe(toolsPackage.dependencies["pdfjs-dist"]);
    expect(version("pako")).toBe("1.0.11");
    expect(PDFJS_VERSION).toBe(toolsPackage.dependencies["pdfjs-dist"]);
    // PDF to JPG fetches the data files from the path this site serves them at.
    expect(PDFJS_ASSETS).toBe(PDFJS_BASE);
    expect(OCR_PDFJS_ASSETS).toBe(PDFJS_BASE);
    expect(version("libheif-js")).toBe(toolsPackage.dependencies["libheif-js"]);
    expect(LIBHEIF_VERSION).toBe(toolsPackage.dependencies["libheif-js"]);
    expect(LIBHEIF_ASSETS).toBe(LIBHEIF_BASE);
    expect(version("tesseract.js-core")).toBe(toolsPackage.dependencies["tesseract.js-core"]);
    expect(TESSERACT_VERSION).toBe(toolsPackage.dependencies["tesseract.js"]);
    expect(TESSERACT_ASSETS).toBe(TESSERACT_BASE);
  });

  it("offers the source of the LGPL library and its licence, next to the unmodified wasm", () => {
    const libheif = credits.find((credit) => credit.license.includes("LGPL"));
    expect(libheif?.sourceUrls?.length).toBeGreaterThan(0);
    expect(libheif?.notice).toContain("GNU Lesser General Public License");
    expect(libheif?.notice).toContain(`${LIBHEIF_BASE}libheif.wasm`);
    expect(libheif?.licenseFiles).toEqual([`${LIBHEIF_BASE}LICENSE.txt`]);
    expect(credits.filter((credit) => credit.license.includes("LGPL"))).toHaveLength(1);
  });

  it("keeps pako's zlib notice word for word", () => {
    const source = readFileSync(
      join(
        repo,
        "node_modules",
        ".pnpm",
        "pako@1.0.11",
        "node_modules",
        "pako",
        "lib",
        "zlib",
        "deflate.js",
      ),
      "utf8",
    );
    const comment = source
      .split("\n")
      .filter((line) => line.startsWith("//"))
      .slice(0, 18)
      .map((line) => line.replace(/^\/\/ ?/, "").trim())
      .filter(Boolean)
      .join(" ");
    // The notice is the same words; the credit joins the two copyright lines with full stops.
    const words = (text: string) => text.replace(/[.\s]+/g, " ").trim();
    expect(words(ZLIB_NOTICE)).toBe(words(comment));
    expect(credits.find((credit) => credit.name === "pako")?.notice).toContain(ZLIB_NOTICE);
  });

  it("links only licence files the vendor route really copies", () => {
    const files = credits.flatMap((credit) => credit.licenseFiles ?? []);
    expect(files.length).toBeGreaterThan(0);
    for (const url of files) {
      if (url.startsWith(LIBHEIF_BASE)) {
        const name = url.slice(LIBHEIF_BASE.length);
        expect(Object.values(LIBHEIF_FILES) as string[], url).toContain(name);
        continue;
      }
      if (url.startsWith(TESSERACT_BASE)) {
        expect(Object.keys(TESSERACT_FILES), url).toContain(url.slice(TESSERACT_BASE.length));
        continue;
      }
      expect(url.startsWith(PDFJS_BASE)).toBe(true);
      const [folder, published] = url.slice(PDFJS_BASE.length).split("/");
      expect(published?.endsWith(".txt"), url).toBe(true);
      const name = published?.replace(/\.txt$/, "");
      const rule = PDFJS_VENDOR_FOLDERS.find((entry) => entry.folder === folder);
      expect(rule?.include.test(name ?? ""), url).toBe(true);
      expect(existsSync(join(installed("pdfjs-dist"), folder ?? "", name ?? "")), url).toBe(true);
    }
  });
});

describe("credits of the video and audio tools (ADR 0061)", () => {
  const find = (name: string) => credits.find((credit) => credit.name.startsWith(name));

  it("credits Mediabunny, its FLAC encoder and gifenc at the versions installed", () => {
    expect(find("Mediabunny")?.version).toBe(toolsPackage.dependencies.mediabunny);
    expect(find("@mediabunny/flac-encoder")?.version).toBe(
      toolsPackage.dependencies["@mediabunny/flac-encoder"],
    );
    expect(find("gifenc")?.version).toBe(toolsPackage.dependencies.gifenc);
  });

  it("links the MPL-2.0 source at the installed tag, and keeps the libFLAC notice", () => {
    const version = toolsPackage.dependencies.mediabunny;
    expect(find("Mediabunny")?.sourceUrls).toContain(
      `https://github.com/Vanilagy/mediabunny/tree/v${version}`,
    );
    const flac = find("@mediabunny/flac-encoder");
    expect(flac?.license).toBe("MPL-2.0 AND BSD-3-Clause");
    expect(flac?.notice).toContain(LIBFLAC_NOTICE);
    expect(LIBFLAC_NOTICE).toContain("Copyright (C) 2011-2025 Xiph.Org Foundation");
    expect(LIBFLAC_NOTICE).toContain("Neither the name of the Xiph.Org Foundation");
  });

  it("matches the licence each installed package declares", () => {
    const declared = (name: string) =>
      (
        JSON.parse(readFileSync(join(installed(name), "package.json"), "utf8")) as {
          license: string;
        }
      ).license;
    expect(declared("mediabunny")).toBe("MPL-2.0");
    expect(declared("@mediabunny/flac-encoder")).toBe("MPL-2.0");
    expect(declared("gifenc")).toBe("MIT");
  });
});
