import { describe, expect, it } from "vitest";
import {
  check,
  EMPTY_ENTRY,
  isDrawable,
  LIMITS,
  layout,
  MESSAGES,
  type Measure,
  outputName,
  type Resume,
  skillList,
  undrawable,
  wrap,
} from "./logic";

/** A stand-in for font metrics: every character is half the font size wide. */
const measure: Measure = (text, size) => text.length * size * 0.5;

const resume: Resume = {
  name: "Sam Lee",
  contact: "sam@example.com\n+44 7700 900123\nLeeds",
  summary: "Support engineer who writes clear documentation.",
  experience: [
    {
      title: "Support Engineer",
      place: "Example Ltd",
      dates: "2022 to now",
      details: "Answered 40 tickets a week\nWrote the setup guide",
    },
  ],
  education: [{ ...EMPTY_ENTRY, title: "BSc Computing", place: "Leeds University" }],
  skills: "SQL, Linux\nWriting",
};

describe("check", () => {
  it("accepts a filled resume and needs a name", () => {
    expect(check(resume)).toEqual([]);
    expect(check({ ...resume, name: " " })).toEqual([MESSAGES.noName]);
  });

  it("takes 10 entries and 2,000 characters, and refuses one more of each", () => {
    const ten = Array.from({ length: LIMITS.maxEntries }, () => EMPTY_ENTRY);
    expect(check({ ...resume, experience: ten, summary: "a".repeat(LIMITS.maxField) })).toEqual([]);
    expect(check({ ...resume, experience: [...ten, EMPTY_ENTRY] })).toEqual([MESSAGES.tooMany]);
    expect(check({ ...resume, summary: "a".repeat(LIMITS.maxField + 1) })).toEqual([
      MESSAGES.tooLong,
    ]);
  });

  it("names the characters the fonts cannot draw, once each", () => {
    const bad = { ...resume, name: "Łukasz Żak", summary: "日本 and Ł" };
    expect(undrawable(bad)).toEqual(["Ł", "Ż", "日", "本"]);
    expect(check(bad)).toEqual([MESSAGES.characters("Ł Ż 日 本")]);
  });

  it("draws Western European letters and the Windows-1252 signs", () => {
    for (const char of "éüßñçøÅ€–—“”‘’•…™Œš") expect(isDrawable(char)).toBe(true);
    for (const char of "ŁĞŐ日🙂") expect(isDrawable(char)).toBe(false);
  });
});

describe("layout", () => {
  it("puts the name first and each filled section in order", () => {
    const [page] = layout(resume, "a4", measure);
    const text = (page ?? []).map((line) => line.text);
    expect(text[0]).toBe("Sam Lee");
    expect(text[1]).toBe("sam@example.com | +44 7700 900123 | Leeds");
    expect(text.filter((line) => line === line.toUpperCase() && /^[A-Z]+$/.test(line))).toEqual([
      "SUMMARY",
      "EXPERIENCE",
      "EDUCATION",
      "SKILLS",
    ]);
    expect(text).toContain("- Answered 40 tickets a week");
    expect(text).toContain("SQL, Linux, Writing");
  });

  it("leaves empty sections out", () => {
    const [page] = layout(
      { ...resume, summary: "", experience: [EMPTY_ENTRY], education: [], skills: "" },
      "letter",
      measure,
    );
    expect((page ?? []).map((line) => line.text)).toEqual([
      "Sam Lee",
      "sam@example.com | +44 7700 900123 | Leeds",
    ]);
  });

  it("runs onto a new page and keeps every line inside the margins", () => {
    const long = {
      ...resume,
      summary: Array.from({ length: 120 }, (_, i) => `Line ${i}`).join("\n"),
    };
    const pages = layout(long, "a4", measure);
    expect(pages.length).toBeGreaterThan(1);
    for (const line of pages.flat()) {
      expect(line.y).toBeGreaterThanOrEqual(54);
      expect(line.x + measure(line.text, line.size, line.bold)).toBeLessThanOrEqual(595.28 - 54);
    }
  });
});

describe("helpers", () => {
  it("wraps at the width and cuts a word longer than a line", () => {
    expect(wrap("aa bb cc", 25, 10, false, measure)).toEqual(["aa bb", "cc"]);
    expect(wrap("abcdefghij", 20, 10, false, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("splits skills on commas and lines, and names the file", () => {
    expect(skillList("a, b\n\nc,")).toEqual(["a", "b", "c"]);
    expect(outputName("Sam Lee")).toBe("Sam-Lee-resume.pdf");
    expect(outputName("José Núñez")).toBe("José-Núñez-resume.pdf");
    expect(outputName("  ")).toBe("resume-resume.pdf");
  });
});
