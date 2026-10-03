import {
  Button,
  createWorkerClient,
  FileResult,
  FileResultList,
  Input,
  Progress,
  Select,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  check,
  EMPTY_ENTRY,
  type Entry,
  type Job,
  type JobResult,
  LIMITS,
  lines,
  MESSAGES,
  outputName,
  PAPERS,
  type Paper,
  type Resume,
  skillList,
} from "./logic";

// The workspace of Resume Builder: the form, a live preview drawn as plain text on this page, and
// the PDF, which worker.ts makes with pdf-lib when the visitor asks for it (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const START: Resume = {
  name: "Sam Lee",
  contact: "sam@example.com\n+44 7700 900123\nLeeds, UK",
  summary: "Support engineer who turns hard questions into clear answers and better documentation.",
  experience: [
    {
      title: "Support Engineer",
      place: "Example Ltd",
      dates: "2022 to now",
      details: "Answered customer questions by email and chat\nWrote the product setup guide",
    },
  ],
  education: [
    { title: "BSc Computing", place: "Example University", dates: "2018 to 2021", details: "" },
  ],
  skills: "SQL, Linux, technical writing",
};

type Section = "experience" | "education";

const LABELS: Record<Section, { title: string; place: string; one: string }> = {
  experience: { title: "Job title", place: "Employer", one: "job" },
  education: { title: "Qualification", place: "School", one: "qualification" },
};

interface Output extends JobResult {
  name: string;
}

export default function ToolUi() {
  const [resume, setResume] = useState<Resume>(START);
  const [paper, setPaper] = useState<Paper>("a4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const problems = check(resume);

  const update = (change: Partial<Resume>) => {
    setResume((current) => ({ ...current, ...change }));
    setOutput(null);
    setError("");
  };
  const editEntry = (section: Section, index: number, change: Partial<Entry>) =>
    update({
      [section]: resume[section].map((entry, i) => (i === index ? { ...entry, ...change } : entry)),
    });

  const make = async () => {
    if (problems.length > 0) return;
    setBusy(true);
    setError("");
    setOutput(null);
    try {
      const result = await client.run({ ...resume, paper });
      setOutput({ ...result, name: outputName(resume.name) });
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const entries = (section: Section) => (
    <section aria-labelledby={`resume-${section}`} className="grid gap-3">
      <h3 id={`resume-${section}`} className="text-lg">
        {section === "experience" ? "Experience" : "Education"}
      </h3>
      {resume[section].map((entry, index) => {
        const id = `resume-${section}-${index + 1}`;
        return (
          <div key={id} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
            <Input
              id={`${id}-title`}
              label={LABELS[section].title}
              value={entry.title}
              onChange={(event) => editEntry(section, index, { title: event.target.value })}
            />
            <Input
              id={`${id}-place`}
              label={LABELS[section].place}
              value={entry.place}
              onChange={(event) => editEntry(section, index, { place: event.target.value })}
            />
            <Input
              id={`${id}-dates`}
              label="Dates"
              value={entry.dates}
              onChange={(event) => editEntry(section, index, { dates: event.target.value })}
            />
            <div className="sm:col-span-3">
              <Textarea
                id={`${id}-details`}
                label="Points, one per line"
                rows={3}
                value={entry.details}
                onChange={(event) => editEntry(section, index, { details: event.target.value })}
              />
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${LABELS[section].one} ${index + 1}`}
                onClick={() => update({ [section]: resume[section].filter((_, i) => i !== index) })}
              >
                Remove
              </Button>
            </div>
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={resume[section].length >= LIMITS.maxEntries}
          onClick={() => update({ [section]: [...resume[section], EMPTY_ENTRY] })}
        >
          Add {LABELS[section].one}
        </Button>
      </div>
    </section>
  );

  const previewEntries = (title: string, list: Entry[]) => {
    const filled = list.filter((entry) =>
      [entry.title, entry.place, entry.dates, entry.details].some((part) => part.trim() !== ""),
    );
    if (filled.length === 0) return null;
    return (
      <>
        <h4 className="mt-3 text-sm font-bold tracking-wide">{title.toUpperCase()}</h4>
        {filled.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the preview follows the form's order
          <div key={index} className="mt-1">
            <p className="font-bold">
              {[entry.title.trim(), entry.place.trim()].filter(Boolean).join(", ")}
            </p>
            {entry.dates.trim() && <p>{entry.dates.trim()}</p>}
            {lines(entry.details).map((point, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
              <p key={i} className="pl-3">
                - {point}
              </p>
            ))}
          </div>
        ))}
      </>
    );
  };

  return (
    <>
      <Input
        id="resume-name"
        label="Full name"
        value={resume.name}
        onChange={(event) => update({ name: event.target.value })}
      />
      <Textarea
        id="resume-contact"
        label="Contact, one item per line"
        hint="Such as email, phone, town and a link."
        rows={3}
        value={resume.contact}
        onChange={(event) => update({ contact: event.target.value })}
      />
      <Textarea
        id="resume-summary"
        label="Summary"
        rows={3}
        value={resume.summary}
        onChange={(event) => update({ summary: event.target.value })}
      />
      {entries("experience")}
      {entries("education")}
      <Textarea
        id="resume-skills"
        label="Skills, separated by commas"
        rows={2}
        value={resume.skills}
        onChange={(event) => update({ skills: event.target.value })}
      />
      <Select
        id="resume-paper"
        label="Paper size"
        value={paper}
        onChange={(event) => setPaper(event.target.value as Paper)}
      >
        {(Object.keys(PAPERS) as Paper[]).map((key) => (
          <option key={key} value={key}>
            {PAPERS[key].label}
          </option>
        ))}
      </Select>

      <section aria-labelledby="resume-preview-title" className="grid gap-2">
        <h3 id="resume-preview-title" className="text-lg">
          Preview
        </h3>
        <div id="resume-preview" className="rounded-xl border border-border bg-surface p-6 text-sm">
          <p className="text-xl font-bold">{resume.name.trim()}</p>
          <p>{lines(resume.contact).join(" | ")}</p>
          {lines(resume.summary).length > 0 && (
            <>
              <h4 className="mt-3 text-sm font-bold tracking-wide">SUMMARY</h4>
              {lines(resume.summary).map((paragraph, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
                <p key={i}>{paragraph}</p>
              ))}
            </>
          )}
          {previewEntries("Experience", resume.experience)}
          {previewEntries("Education", resume.education)}
          {skillList(resume.skills).length > 0 && (
            <>
              <h4 className="mt-3 text-sm font-bold tracking-wide">SKILLS</h4>
              <p>{skillList(resume.skills).join(", ")}</p>
            </>
          )}
        </div>
        <p className="text-sm text-fg-muted">
          The PDF uses the same order and text; its line breaks may differ from this preview.
        </p>
      </section>

      {problems.length > 0 && (
        <div id="resume-problems" role="alert">
          <ul className="grid gap-1 text-sm text-danger-text">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={problems.length > 0}
          onClick={() => void make()}
        >
          Make PDF
        </Button>
      </div>
      {busy && <Progress label="Making the PDF" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {output && (
        <FileResultList label="Your resume">
          <FileResult
            name={output.name}
            meta={`${output.pages} ${output.pages === 1 ? "page" : "pages"}`}
            state="done"
            icon="pdf"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "application/pdf" })}
              >
                Download
              </Button>
            }
          />
        </FileResultList>
      )}
    </>
  );
}
