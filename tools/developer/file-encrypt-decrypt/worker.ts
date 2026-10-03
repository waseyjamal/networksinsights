import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  checkFile,
  decrypt,
  decryptedName,
  encrypt,
  encryptedName,
  FormatError,
  type Job,
  type JobResult,
  MESSAGES,
} from "./logic";

// The Web Worker of "File Encrypt and Decrypt" (ADR 0051). PBKDF2 and AES-GCM run here so the page
// stays responsive. The password arrives with the job, is passed to logic.ts and is never logged,
// stored or sent back.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const refused = checkFile(job.mode, job.file);
  if (refused) throw new ToolError(refused);
  progress({ done: 0, total: 2, stage: "Reading" });
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  signal.throwIfAborted();
  progress({ done: 1, total: 2, stage: job.mode === "encrypt" ? "Encrypting" : "Decrypting" });
  try {
    if (job.mode === "encrypt") {
      const sealed = await encrypt(bytes, job.name, job.password);
      progress({ done: 2, total: 2 });
      return {
        blob: new Blob([sealed as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }),
        name: encryptedName(job.name),
      };
    }
    const opened = await decrypt(bytes, job.password);
    progress({ done: 2, total: 2 });
    return {
      blob: new Blob([opened.data as Uint8Array<ArrayBuffer>], {
        type: "application/octet-stream",
      }),
      name: decryptedName(opened.name, job.name),
    };
  } catch (caught) {
    if (caught instanceof FormatError) throw new ToolError(caught.message);
    throw new ToolError(MESSAGES.failed);
  }
});
