import {
  Alert,
  Button,
  Checkbox,
  createWorkerClient,
  DataTable,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  checkFile,
  emptyValues,
  FIELD_LABELS,
  FIELDS,
  formatDate,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  type Metadata,
  outputName,
  type Values,
} from "./logic";

// The workspace of PDF Metadata Editor. Choosing a PDF starts worker.ts, which reads its
// information fields with pdf-lib; the visitor edits them and Save writes a new file, which the
// worker reads back so the table shows what is really in it. pdf-lib loads only with the worker.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
  metadata: Metadata;
}

interface Output {
  blob: Blob;
  name: string;
  metadata: Metadata;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const rowsOf = (metadata: Metadata) => [
  ...FIELDS.map((field) => [
    FIELD_LABELS[field].replace(/ \(.*\)$/, ""),
    metadata.values[field] || "(none)",
  ]),
  ["Created", formatDate(metadata.created) || "(none)"],
  ["Modified", formatDate(metadata.modified) || "(none)"],
  ["XMP metadata stream", metadata.hasXmp ? "Present" : "None"],
];

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [values, setValues] = useState<Values>(emptyValues);
  const [removeDates, setRemoveDates] = useState(false);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setBusy(true);
    try {
      const result = await client.run({ kind: "open", file });
      if (result.kind !== "open") return;
      setSource({ file, pages: result.pages, metadata: result.metadata });
      setValues(result.metadata.values);
      setRemoveDates(false);
      setFileError("");
    } catch (caught) {
      setSource(null);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!source) return;
    setOutput(null);
    setError("");
    setBusy(true);
    try {
      const result = await client.run({ kind: "save", file: source.file, values, removeDates });
      if (result.kind === "save") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name),
          metadata: result.metadata,
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="pdf-metadata-editor-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <DataTable
            id="pdf-metadata-editor-original"
            label={`Metadata now in ${source.file.name}`}
            columns={["Field", "Value"]}
            rows={rowsOf(source.metadata)}
          />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <Input
                key={field}
                id={`pdf-metadata-editor-field-${field}`}
                label={FIELD_LABELS[field]}
                maxLength={LIMITS.maxFieldChars}
                value={values[field]}
                onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              />
            ))}
          </div>
          <Checkbox
            id="pdf-metadata-editor-dates"
            label="Remove the creation and modification dates"
            checked={removeDates}
            onChange={(event) => setRemoveDates(event.target.checked)}
          />
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setValues(emptyValues())}>
              Clear all fields
            </Button>
          </div>
          <Alert tone="info" title="What is changed">
            An empty field is removed from the file. The XMP metadata stream of the document is
            removed too, so it cannot show the old values. Other metadata, such as XMP attached to
            pages, pictures or fonts, or old values kept inside the file from earlier edits, may
            remain: this tool cannot remove it.
          </Alert>
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <>
          <FileResultList label="PDF with new metadata">
            <FileResult
              name={output.name}
              meta={formatSize(output.blob.size)}
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
          <DataTable
            id="pdf-metadata-editor-saved"
            label="Metadata in the saved file"
            columns={["Field", "Value"]}
            rows={rowsOf(output.metadata)}
          />
        </>
      )}
    </>
  );
}
