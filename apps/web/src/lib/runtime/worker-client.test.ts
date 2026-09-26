import { defineWorker, ToolError, type WorkerHandler } from "@networksinsights/tool-sdk/worker";
import { describe, expect, it } from "vitest";
import {
  createWorkerClient,
  STOPPED_INFO,
  WORKER_FAILED_MESSAGE,
  WorkerJobError,
  type WorkerLike,
} from "./worker-client";

// The real defineWorker() runs in a fake worker: messages cross as structured clones, one task
// later, as they would between a page and a Web Worker.

type Listener = (event: { data: unknown }) => void;

function fakeWorker<I, O>(handler: WorkerHandler<I, O>) {
  const toWorker: Listener[] = [];
  const toPage: Listener[] = [];
  const failures: Array<() => void> = [];
  const state = { terminated: false, started: 0 };
  const deliver = (listeners: Listener[], data: unknown) => {
    const copy = structuredClone(data);
    setTimeout(() => {
      if (state.terminated) return;
      for (const listener of listeners) listener({ data: copy });
    }, 0);
  };
  const create = (): WorkerLike => {
    state.started++;
    state.terminated = false;
    toWorker.length = 0;
    toPage.length = 0;
    failures.length = 0;
    defineWorker<I, O>(handler, {
      scope: {
        postMessage: (message) => deliver(toPage, message),
        addEventListener: (_type, listener) => toWorker.push(listener),
      },
    });
    return {
      postMessage: (message) => deliver(toWorker, message),
      terminate: () => {
        state.terminated = true;
      },
      addEventListener: ((type: string, listener: Listener & (() => void)) => {
        if (type === "message") toPage.push(listener);
        else failures.push(listener);
      }) as WorkerLike["addEventListener"],
    };
  };
  const crash = () => {
    for (const fail of failures) fail();
  };
  return { create, state, crash };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createWorkerClient", () => {
  it("runs a job in the worker and gives back its result, with progress on the way", async () => {
    const fake = fakeWorker<number, number>(async (input, { progress }) => {
      progress({ done: 1, total: 2, stage: "Halfway" });
      return input * 2;
    });
    const client = createWorkerClient<number, number>(fake.create);
    const seen: unknown[] = [];
    await expect(client.run(21, { onProgress: (p) => seen.push(p) })).resolves.toBe(42);
    expect(seen).toEqual([{ done: 1, total: 2, stage: "Halfway" }]);
  });

  it("starts the worker on the first run only, and keeps one worker for every job", async () => {
    const fake = fakeWorker<number, number>((input) => input + 1);
    const client = createWorkerClient<number, number>(fake.create);
    expect(fake.state.started).toBe(0);
    await Promise.all([client.run(1), client.run(2), client.run(3)]);
    expect(fake.state.started).toBe(1);
  });

  it("passes a ToolError's message to the page, and hides any other error's text", async () => {
    const fake = fakeWorker<string, never>((input) => {
      if (input === "tool") throw new ToolError("This file is not an image.");
      throw new TypeError("internal detail");
    });
    const client = createWorkerClient<string, never>(fake.create);
    const expected = await client.run("tool").catch((error: unknown) => error);
    expect(expected).toBeInstanceOf(WorkerJobError);
    expect(expected).toMatchObject({ message: "This file is not an image.", expected: true });
    const other = await client.run("other").catch((error: unknown) => error);
    expect(other).toMatchObject({ expected: false, causeName: "TypeError" });
  });

  it("rejects at once on cancel, and keeps a worker whose job stops by itself", async () => {
    const fake = fakeWorker<number, number>(async (_input, { signal }) => {
      while (!signal.aborted) await wait(5);
      signal.throwIfAborted();
      return 0;
    });
    const client = createWorkerClient<number, number>(fake.create, { cancelGraceMs: 200 });
    const controller = new AbortController();
    const job = client.run(1, { signal: controller.signal });
    await wait(10);
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: "AbortError" });
    await wait(250);
    expect(fake.state.terminated).toBe(false);
  });

  it("terminates a worker that does not stop within the grace period", async () => {
    const fake = fakeWorker<number, number>(() => new Promise<number>(() => {}));
    const client = createWorkerClient<number, number>(fake.create, { cancelGraceMs: 20 });
    const controller = new AbortController();
    const cancelled = client.run(1, { signal: controller.signal });
    const bystander = client.run(2).catch((error: unknown) => error);
    await wait(5);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await wait(40);
    expect(fake.state.terminated).toBe(true);
    expect(await bystander).toMatchObject({ message: STOPPED_INFO.message, expected: true });
    // The next job starts a fresh worker.
    const next = client.run(3);
    expect(fake.state.started).toBe(2);
    void next.catch(() => {});
  });

  it("rejects a job whose signal is already aborted without starting the worker", async () => {
    const fake = fakeWorker<number, number>((input) => input);
    const client = createWorkerClient<number, number>(fake.create);
    await expect(client.run(1, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fake.state.started).toBe(0);
  });

  it("rejects every waiting job when the worker fails, and starts a new one next time", async () => {
    const fake = fakeWorker<number, number>(() => new Promise<number>(() => {}));
    const client = createWorkerClient<number, number>(fake.create);
    const jobs = [client.run(1), client.run(2)].map((job) => job.catch((error: unknown) => error));
    await wait(5);
    fake.crash();
    for (const error of await Promise.all(jobs)) {
      expect(error).toMatchObject({ message: WORKER_FAILED_MESSAGE, expected: true });
    }
    void client.run(3).catch(() => {});
    expect(fake.state.started).toBe(2);
  });

  it("ignores messages that are not of the protocol", async () => {
    const fake = fakeWorker<number, number>((input) => input);
    const client = createWorkerClient<number, number>(fake.create);
    const job = client.run(5);
    await expect(job).resolves.toBe(5);
  });

  it("dispose() terminates the worker and rejects what was waiting", async () => {
    const fake = fakeWorker<number, number>(() => new Promise<number>(() => {}));
    const client = createWorkerClient<number, number>(fake.create);
    const job = client.run(1).catch((error: unknown) => error);
    client.dispose();
    expect(await job).toMatchObject({ name: "AbortError" });
    expect(fake.state.terminated).toBe(true);
  });
});
