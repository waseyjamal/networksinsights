// Pure logic of "Resume Builder": the form's rules, the characters the PDF's standard fonts can
// draw, and the layout of a one-column resume as a list of text lines placed on pages. No DOM, no
// network and no top-level statements (docs/tool-contract.md). worker.ts measures text with
// pdf-lib's Helvetica and draws the lines this file places.

export const LIMITS = {
  /** Our own caps: enough for a long career, small enough to keep the form quick. */
  maxEntries: 10,
  maxField: 2000,
} as const;

export interface Entry {
  /** A job title, or a degree or certificate. */
  title: string;
  /** The employer, or the school. */
  place: string;
  dates: string;
  /** One point per line; each becomes a bullet. */
  details: string;
}

export interface Resume {
  name: string;
  /** One item per line: email, phone, town, a link. */
  contact: string;
  summary: string;
  experience: Entry[];
  education: Entry[];
  /** Separated by commas or new lines. */
  skills: string;
}

export const PAPERS = {
  a4: { label: "A4", width: 595.28, height: 841.89 },
  letter: { label: "US Letter", width: 612, height: 792 },
} as const;

export type Paper = keyof typeof PAPERS;

export interface Input extends Resume {
  paper: Paper;
}

export type Job = Input;

export interface JobResult {
  blob: Blob;
  pages: number;
}

export const MESSAGES = {
  noName: "Type your name.",
  tooLong: `Keep each field under ${LIMITS.maxField} characters.`,
  tooMany: `Add at most ${LIMITS.maxEntries} entries in a section.`,
  failed: "The PDF could not be made.",
  characters: (list: string) =>
    `The PDF fonts cannot draw these characters: ${list}. They cover English and most Western European letters only. Replace them, or write the word in Latin letters.`,
} as const;

/**
 * The characters of Windows-1252 above ASCII, which pdf-lib's standard fonts can encode (WinAnsi):
 * the Latin-1 letters and signs, plus these from 0x80 to 0x9F.
 */
const WIN_ANSI_EXTRA = [
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
] as const;

export function isDrawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x0a || code === 0x0d || code === 0x09) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return (WIN_ANSI_EXTRA as readonly number[]).includes(code);
}

/** Every text field of the resume, for the checks. */
function texts(resume: Resume): string[] {
  const entries = [...resume.experience, ...resume.education].flatMap((entry) => [
    entry.title,
    entry.place,
    entry.dates,
    entry.details,
  ]);
  return [resume.name, resume.contact, resume.summary, resume.skills, ...entries];
}

/** The characters the fonts cannot draw, each once, in the order they first appear. */
export function undrawable(resume: Resume): string[] {
  const seen = new Set<string>();
  for (const text of texts(resume)) {
    for (const char of text) if (!isDrawable(char)) seen.add(char);
  }
  return [...seen];
}

/** Every problem with the form; an empty list when the PDF can be made. */
export function check(resume: Resume): string[] {
  const problems: string[] = [];
  if (resume.name.trim() === "") problems.push(MESSAGES.noName);
  if (texts(resume).some((text) => text.length > LIMITS.maxField)) problems.push(MESSAGES.tooLong);
  if (resume.experience.length > LIMITS.maxEntries || resume.education.length > LIMITS.maxEntries) {
    problems.push(MESSAGES.tooMany);
  }
  const bad = undrawable(resume);
  if (bad.length > 0) problems.push(MESSAGES.characters(bad.join(" ")));
  return problems;
}

export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

export function skillList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "");
}

/** Text width in points for a size and weight; worker.ts passes pdf-lib's Helvetica metrics. */
export type Measure = (text: string, size: number, bold: boolean) => number;

/** Breaks text into lines no wider than `width`; a word longer than a line is cut. */
export function wrap(text: string, width: number, size: number, bold: boolean, measure: Measure) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter((part) => part !== "")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, size, bold) <= width) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    let rest = word;
    while (measure(rest, size, bold) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), size, bold) > width) cut--;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

export interface Line {
  text: string;
  x: number;
  /** The baseline, in points from the bottom of the page, as PDF counts. */
  y: number;
  size: number;
  bold: boolean;
}

export const STYLE = {
  margin: 54,
  name: 20,
  heading: 12,
  body: 10,
  leading: 1.35,
  indent: 12,
} as const;

/**
 * Places every line of the resume on pages: the name, the contact line, then Summary,
 * Experience, Education and Skills, each section left out when it is empty. Text runs on to a new
 * page when one is full.
 */
export function layout(resume: Resume, paper: Paper, measure: Measure): Line[][] {
  const { width, height } = PAPERS[paper];
  const { margin } = STYLE;
  const right = width - margin;
  const pages: Line[][] = [[]];
  let y = height - margin;

  const add = (text: string, size: number, bold: boolean, x: number = margin, gapBefore = 0) => {
    for (const piece of wrap(text, right - x, size, bold, measure)) {
      const step = size * STYLE.leading;
      y -= gapBefore + step;
      gapBefore = 0;
      if (y < margin) {
        pages.push([]);
        y = height - margin - step;
      }
      pages[pages.length - 1]?.push({ text: piece, x, y, size, bold });
    }
  };

  add(resume.name.trim(), STYLE.name, true);
  const contact = lines(resume.contact);
  if (contact.length > 0) add(contact.join(" | "), STYLE.body, false, margin, 2);

  const section = (title: string) => add(title.toUpperCase(), STYLE.heading, true, margin, 12);

  const summary = lines(resume.summary);
  if (summary.length > 0) {
    section("Summary");
    for (const paragraph of summary) add(paragraph, STYLE.body, false, margin, 2);
  }

  const entries = (title: string, list: Entry[]) => {
    const filled = list.filter((entry) =>
      [entry.title, entry.place, entry.dates, entry.details].some((part) => part.trim() !== ""),
    );
    if (filled.length === 0) return;
    section(title);
    for (const entry of filled) {
      const head = [entry.title.trim(), entry.place.trim()].filter(Boolean).join(", ");
      if (head) add(head, STYLE.body, true, margin, 6);
      if (entry.dates.trim()) add(entry.dates.trim(), STYLE.body, false);
      for (const point of lines(entry.details)) {
        add(`- ${point}`, STYLE.body, false, margin + STYLE.indent);
      }
    }
  };
  entries("Experience", resume.experience);
  entries("Education", resume.education);

  const skills = skillList(resume.skills);
  if (skills.length > 0) {
    section("Skills");
    add(skills.join(", "), STYLE.body, false, margin, 2);
  }
  return pages;
}

/** `Sam Lee` gives `Sam-Lee-resume.pdf`. */
export function outputName(name: string): string {
  const base = name
    .trim()
    .replace(/[^A-Za-z0-9À-ɏ]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "resume"}-resume.pdf`;
}

export const EMPTY_ENTRY: Entry = { title: "", place: "", dates: "", details: "" };
