import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFJS_ASSETS } from "../../../../tools/pdf/pdf-to-jpg/logic";
import { credits, ZLIB_NOTICE } from "./credits";
import { PDFJS_BASE, PDFJS_VENDOR_FOLDERS, PDFJS_VERSION } from "./pdfjs";

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
