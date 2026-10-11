import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAppShell, formatAppShellReport, isAppShellScript } from "./lib/app-shell";

const SHELL = "_astro/AppShell.astro_astro_type_script_index_0_lang.AbC.js";

const page = (extra = "") =>
  `<html><body><div data-ni-search></div><script type="module" src="/${SHELL}"></script>${extra}</body></html>`;

let dist: string;
const write = (path: string, content: string | Buffer) => {
  const file = join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "ni-app-shell-"));
  write("index.html", page());
  write("about/index.html", page());
  write(SHELL, 'document.addEventListener("click",()=>{})');
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

const problems = () => checkAppShell(dist).violations.map((v) => v.problem);

describe("checkAppShell", () => {
  it("passes a complete build and reports its size", () => {
    const report = checkAppShell(dist);
    expect(report.violations).toEqual([]);
    expect(report.pages).toBe(2);
    expect(formatAppShellReport(report)).toMatch(/✓ AppShell\.astro.*of 1\.0 KB.*on 2 pages/);
  });

  it("fails a page without the app shell, or with it twice", () => {
    write("about/index.html", page().replace(/<script[^>]*><\/script>/, ""));
    write("terms/index.html", page(`<script type="module" src="/${SHELL}"></script>`));
    expect(problems()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/has 0 app shell scripts/),
        expect.stringMatching(/has 2 app shell scripts/),
      ]),
    );
  });

  it("fails an app shell loaded as a classic script", () => {
    write("about/index.html", page().replace(' type="module"', ""));
    expect(problems()).toEqual(["loads the app shell as a classic script"]);
  });

  it("fails an app shell over 1 KB gzip", () => {
    write(SHELL, randomBytes(4000));
    expect(problems()).toEqual([expect.stringMatching(/the limit is 1024 B/)]);
  });

  it("fails an app shell that imports anything, statically or on demand", () => {
    write("_astro/extra.js", "export const x = 1;");
    write(SHELL, 'import "./extra.js";');
    expect(problems()).toEqual([expect.stringMatching(/the app shell imports _astro\/extra\.js/)]);
    write(SHELL, 'import("./extra.js");');
    expect(problems()).toEqual([expect.stringMatching(/the app shell imports _astro\/extra\.js/)]);
  });
});

describe("helpers", () => {
  it("recognizes the app shell script and nothing else", () => {
    expect(isAppShellScript(SHELL)).toBe(true);
    expect(isAppShellScript("_astro/ServiceWorker.astro_astro_type_script_index_0_lang.X.js")).toBe(
      false,
    );
  });
});
