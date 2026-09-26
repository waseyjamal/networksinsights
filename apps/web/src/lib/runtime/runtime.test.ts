import { describe, expect, it, vi } from "vitest";
import { REVOKE_AFTER_MS, type SaveFileEnvironment, saveFile } from "./save-file";
import { safeUrl, setText } from "./text";

/** A fake browser that records what saveFile did. */
function fakeBrowser() {
  const link = {
    href: "",
    download: "",
    rel: "",
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  };
  const blobs: Blob[] = [];
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const revoked: string[] = [];
  const env: SaveFileEnvironment = {
    document: {
      createElement: vi.fn(() => link) as unknown as Document["createElement"],
      body: { append: vi.fn() } as unknown as HTMLElement,
    },
    createObjectURL: (blob) => {
      blobs.push(blob);
      return `blob:https://networksinsights.com/${blobs.length}`;
    },
    revokeObjectURL: (url) => revoked.push(url),
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
  };
  return { env, link, blobs, timers, revoked };
}

describe("saveFile", () => {
  it("downloads through a link with a safe name and the right type", async () => {
    const fake = fakeBrowser();
    const result = saveFile("hello", "../notes: draft.txt", {}, fake.env);
    expect(result).toEqual({ filename: "-notes- draft.txt", type: "text/plain;charset=utf-8" });
    expect(fake.link.download).toBe("-notes- draft.txt");
    expect(fake.link.href).toBe("blob:https://networksinsights.com/1");
    expect(fake.link.rel).toBe("noopener");
    expect(fake.link.click).toHaveBeenCalledOnce();
    expect(fake.link.remove).toHaveBeenCalledOnce();
    expect(fake.blobs[0]?.type).toBe("text/plain;charset=utf-8");
    expect(await fake.blobs[0]?.text()).toBe("hello");
  });

  it("revokes the object URL after the download has started, not before", () => {
    const fake = fakeBrowser();
    saveFile("x", "a.txt", {}, fake.env);
    expect(fake.revoked).toEqual([]);
    expect(fake.timers).toHaveLength(1);
    expect(fake.timers[0]?.ms).toBe(REVOKE_AFTER_MS);
    fake.timers[0]?.callback();
    expect(fake.revoked).toEqual(["blob:https://networksinsights.com/1"]);
  });

  it("still revokes the URL when the click throws", () => {
    const fake = fakeBrowser();
    fake.link.click.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveFile("x", "a.txt", {}, fake.env)).toThrow("blocked");
    fake.timers[0]?.callback();
    expect(fake.revoked).toHaveLength(1);
  });

  it("re-types a Blob that claims another type", () => {
    const fake = fakeBrowser();
    saveFile(new Blob(["<b>hi</b>"], { type: "text/html" }), "page.txt", {}, fake.env);
    expect(fake.blobs[0]?.type).toBe("text/plain;charset=utf-8");
  });

  it("honours an explicit type, a forced extension and a fallback name", () => {
    const fake = fakeBrowser();
    expect(saveFile("x", "", { extension: "csv", fallback: "table" }, fake.env)).toEqual({
      filename: "table.csv",
      type: "text/csv;charset=utf-8",
    });
    expect(saveFile("x", "a.bin", { type: "application/x-custom" }, fake.env).type).toBe(
      "application/x-custom",
    );
    expect(saveFile("x", "archive.weird", {}, fake.env).type).toBe("application/octet-stream");
  });
});

describe("setText", () => {
  it("writes text, never markup", () => {
    const node = { textContent: "" as string | null };
    setText(node, "<img src=x onerror=alert(1)>");
    expect(node.textContent).toBe("<img src=x onerror=alert(1)>");
    setText(node, 42);
    expect(node.textContent).toBe("42");
    setText(node, null);
    expect(node.textContent).toBe("");
  });
});

describe("safeUrl", () => {
  it("keeps absolute http, https and mailto URLs, normalized", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
    expect(safeUrl("  http://example.com/a b ")).toBe("http://example.com/a%20b");
    expect(safeUrl("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  it("refuses every scheme that can run code or carry a document", () => {
    for (const value of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://networksinsights.com/1",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(safeUrl(value), value).toBe(undefined);
    }
  });

  it("refuses what is not an absolute URL", () => {
    for (const value of ["", "example.com", "/relative", "//example.com", "not a url"]) {
      expect(safeUrl(value), value).toBe(undefined);
    }
  });
});
