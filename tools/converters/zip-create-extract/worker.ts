import { type AbortSignalLike, defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { Inflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import {
  crc32,
  dataOffset,
  type Job,
  type JobResult,
  locateDirectory,
  MESSAGES,
  METHODS,
  planExtract,
  readDirectory,
  TAIL_BYTES,
  type ZipFile,
} from "./logic";

// The Web Worker of "ZIP create and extract". A ZIP is never read whole: the worker reads its end
// record and its list of files, and later only the bytes of the one file a visitor asks for.
// fflate inflates that file in pieces, and stops the moment it unpacks to more than the ZIP
// declared, so a zip bomb cannot fill the memory. Nothing leaves the device.

/** Compressed bytes fed to the inflater at a time. */
const PIECE = 64 * 1024;

async function bytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function list(file: Blob) {
  const tail = await bytes(file, Math.max(0, file.size - TAIL_BYTES), file.size);
  const located = locateDirectory(tail, file.size);
  if (!located.ok) throw new ToolError(located.message);
  const { offset, size, entries } = located.directory;
  const parsed = readDirectory(await bytes(file, offset, offset + size), entries);
  if (!parsed.ok) throw new ToolError(parsed.message);
  return planExtract(parsed.records);
}

async function extract(file: Blob, entry: ZipFile, signal: AbortSignalLike): Promise<Blob> {
  if (entry.problem) throw new ToolError(entry.problem);
  const header = await bytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const start = dataOffset(header, entry.localHeaderOffset);
  const end = start === null ? 0 : start + entry.compressedSize;
  if (start === null || end > file.size) throw new ToolError(MESSAGES.damaged);

  const chunks: Uint8Array[] = [];
  let produced = 0;
  let crc = 0;
  const take = (chunk: Uint8Array) => {
    produced += chunk.length;
    // Stop at once when a file unpacks to more than declared: the mark of a zip bomb.
    if (produced > entry.size) throw new ToolError(MESSAGES.bomb(entry.path));
    crc = crc32(chunk, crc);
    chunks.push(chunk);
  };

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ToolError(MESSAGES.bomb(entry.path));
    for (let at = start; at < end; at += PIECE) {
      signal.throwIfAborted();
      take(await bytes(file, at, Math.min(end, at + PIECE)));
    }
  } else {
    const inflater = new Inflate((chunk) => take(chunk));
    try {
      for (let at = start; at < end; at += PIECE) {
        signal.throwIfAborted();
        const next = Math.min(end, at + PIECE);
        inflater.push(await bytes(file, at, next), next === end);
      }
      if (start === end) inflater.push(new Uint8Array(0), true);
    } catch (caught) {
      if (caught instanceof ToolError || signal.aborted) throw caught;
      throw new ToolError(MESSAGES.badCrc(entry.path));
    }
  }
  if (produced !== entry.size || crc !== entry.crc32)
    throw new ToolError(MESSAGES.badCrc(entry.path));
  return new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
}

async function create(
  job: Extract<Job, { kind: "create" }>,
  signal: AbortSignalLike,
  progress: (done: number, total: number) => void,
): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  let finished = false;
  const zip = new Zip((error, data, final) => {
    if (error) failure = error;
    else parts.push(data);
    if (final) finished = true;
  });
  const total = job.files.reduce((sum, file) => sum + file.size, 0);
  let done = 0;
  for (const [index, file] of job.files.entries()) {
    const name = job.names[index] ?? `file-${index + 1}`;
    const entry =
      job.method === "store"
        ? new ZipPassThrough(name)
        : new ZipDeflate(name, { level: METHODS.deflate.level });
    entry.mtime = job.modified[index] ?? Date.now();
    zip.add(entry);
    const reader = file.stream().getReader();
    for (;;) {
      signal.throwIfAborted();
      const { value, done: last } = await reader.read();
      if (last) break;
      entry.push(value, false);
      done += value.length;
      progress(done, total);
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure || !finished) throw new ToolError(MESSAGES.failed);
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "list") return { kind: "list", plan: await list(job.file) };
  if (job.kind === "extract")
    return { kind: "extract", blob: await extract(job.file, job.entry, signal) };
  const blob = await create(job, signal, (done, total) =>
    progress({ done, total: Math.max(total, 1), stage: "Adding files" }),
  );
  return { kind: "create", blob };
});
