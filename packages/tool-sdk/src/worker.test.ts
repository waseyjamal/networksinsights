import { describe, expect, it } from "vitest";
import {
  defineWorker,
  isProtocolMessage,
  type MessageFromWorker,
  ToolError,
  toErrorInfo,
  WORKER_PROTOCOL,
  type WorkerHandler,
} from "./worker";

/** defineWorker() with a scope that records what it posts; `send` delivers a message to it. */
function harness<I, O>(handler: WorkerHandler<I, O>) {
  const posted: MessageFromWorker<O>[] = [];
  let listener: ((event: { data: unknown }) => void) | undefined;
  defineWorker<I, O>(handler, {
    scope: {
      postMessage: (message) => posted.push(message as MessageFromWorker<O>),
      addEventListener: (_type, next) => {
        listener = next;
      },
    },
  });
  const send = (data: unknown) => listener?.({ data });
  const settled = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { posted, send, settled };
}

const run = (id: number, input: unknown) => ({ protocol: WORKER_PROTOCOL, type: "run", id, input });

describe("defineWorker", () => {
  it("answers a run with its result, after the progress it reported", async () => {
    const { posted, send, settled } = harness<number, number>((input, { progress }) => {
      progress({ done: 1, total: 1 });
      return input + 1;
    });
    send(run(7, 1));
    await settled();
    expect(posted.map((message) => message.type)).toEqual(["progress", "result"]);
    expect(posted[1]).toEqual({ protocol: WORKER_PROTOCOL, type: "result", id: 7, output: 2 });
  });

  it("ignores anything that is not a message of the protocol", async () => {
    const { posted, send, settled } = harness<number, number>((input) => input);
    send("hello");
    send({ type: "run", id: 1, input: 1 });
    send({ protocol: 99, type: "run", id: 1, input: 1 });
    send({ protocol: WORKER_PROTOCOL, type: "run", id: "1", input: 1 });
    await settled();
    expect(posted).toEqual([]);
  });

  it("answers cancelled, not result, when the job was cancelled while it ran", async () => {
    let finish: (value: number) => void = () => {};
    const { posted, send, settled } = harness<number, number>(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    send(run(1, 0));
    send({ protocol: WORKER_PROTOCOL, type: "cancel", id: 1 });
    finish(5);
    await settled();
    expect(posted).toEqual([{ protocol: WORKER_PROTOCOL, type: "cancelled", id: 1 }]);
  });

  it("reports a handler's error with its name, and marks a ToolError as meant for the visitor", async () => {
    const { posted, send, settled } = harness<string, never>((input) => {
      throw input === "tool" ? new ToolError("Not an image.") : new RangeError("detail");
    });
    send(run(1, "tool"));
    send(run(2, "other"));
    await settled();
    expect(posted).toEqual([
      {
        protocol: WORKER_PROTOCOL,
        type: "error",
        id: 1,
        error: { name: "ToolError", message: "Not an image.", expected: true },
      },
      {
        protocol: WORKER_PROTOCOL,
        type: "error",
        id: 2,
        error: { name: "RangeError", message: "detail", expected: false },
      },
    ]);
  });
});

describe("the protocol helpers", () => {
  it("recognises only messages of this version with a numeric id", () => {
    expect(isProtocolMessage(run(1, null))).toBe(true);
    expect(isProtocolMessage(null)).toBe(false);
    expect(isProtocolMessage({ protocol: WORKER_PROTOCOL, type: "run" })).toBe(false);
  });

  it("turns any thrown value into error info", () => {
    expect(toErrorInfo("text")).toEqual({ name: "Error", message: "text", expected: false });
  });
});
