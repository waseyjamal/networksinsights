import { readFileSync } from "node:fs";
import { expect, type Page, type Route, test } from "@playwright/test";
import { ENGINE, MESSAGES, MODEL } from "../../../tools/video-audio/speech-to-text/logic";
import manifest from "../../../tools/video-audio/speech-to-text/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { sineWav } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Speech to Text against `wrangler dev` (real CSP and headers): nothing of the model loads before the
// button is pressed; then the worker fetches Whisper tiny's encoder, the decoder's two parts and the
// vocabulary from /models/, checks every hash and the joined decoder's, and transcribes real speech:
// a public-domain LibriVox reading of the Gettysburg Address (e2e/fixtures/README.md). Every wait is
// for a state the page shows (data-state on the workspace), never for a fixed time.
//
// The expected words are ones Whisper tiny gave for these clips in onnxruntime-web 1.30.0 under
// Node, window by window, before any browser ran them (ADR 0068); each is checked without regard to
// case, so a different capital at the start of a window does not matter.

test.use({ baseURL: edgeURL });
test.setTimeout(300_000);

const PATH = "/speech-to-text/";
const DONE = { timeout: 240_000 };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const wav = (name: string, buffer: Buffer) => ({ name, mimeType: "audio/wav", buffer });
const SHORT = () => wav("gettysburg.wav", fixture("speech-13s.wav"));
const LONG = () => wav("gettysburg-70s.wav", fixture("speech-70s.wav"));

const workspace = (page: Page) => page.locator("#speech-to-text-workspace");
const input = (page: Page) => page.locator("#speech-to-text-file");
const start = (page: Page) => page.locator("#speech-to-text-start");
const output = (page: Page) => page.locator("#speech-to-text-output");
const MODEL_URLS = [
  MODEL.encoder.url,
  ...MODEL.decoderParts.map((part) => part.url),
  MODEL.vocab.url,
];

function watchRequests(page: Page) {
  const paths: string[] = [];
  const foreign: string[] = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(edgeURL).origin) paths.push(url.pathname);
    else if (url.protocol.startsWith("http")) foreign.push(request.url());
  });
  return { paths, foreign, models: () => paths.filter((path) => path.startsWith("/models/")) };
}

async function choose(page: Page, file: ReturnType<typeof SHORT>) {
  await input(page).setInputFiles(file);
  await expect(workspace(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
}

const expectWords = async (page: Page, words: readonly string[]) => {
  const text = (await output(page).inputValue()).toLowerCase();
  for (const word of words) expect(text, `"${word}" in: ${text}`).toContain(word);
};

test("transcribes a short English clip after the visitor asks for the model, from this site only", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await expect(page.locator("#speech-to-text-download")).toHaveText(
    "The model is 39.9 MB and downloads only when you press the button. The engine that runs it adds 13.6 MB unless your browser already has it. After that, your recording stays on this device.",
  );

  await choose(page, SHORT());
  await expect(page.locator("#speech-to-text-file-info")).toHaveText("gettysburg.wav: 0:13");
  await expect(start(page)).toHaveText("Download the model (39.9 MB) and transcribe");
  expect(requests.models()).toEqual([]);

  await start(page).click();
  await expect(workspace(page)).toHaveAttribute("data-state", "done", DONE);
  await expect(page.locator("#speech-to-text-summary")).toHaveText(
    "gettysburg.wav: 0:13, heard in 1 part of up to 30 seconds",
  );
  await expectWords(page, ["brought forth", "continent", "created equal"]);
  console.log(`speech-to-text short: ${await output(page).inputValue()}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download TXT" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("gettysburg-transcript.txt");
  expect(readFileSync((await download.path()) ?? "", "utf8")).toBe(await output(page).inputValue());

  // The model stays in the worker: the next recording needs no download.
  await choose(page, SHORT());
  await expect(start(page)).toHaveText("Transcribe");

  for (const url of MODEL_URLS) expect(requests.models()).toContain(url);
  expect(requests.paths).toContain(`${ENGINE.base}${ENGINE.wasm}`);
  expect(requests.paths.some((path) => /jsep|jspi|asyncify|webgpu/.test(path))).toBe(false);
  expect(requests.foreign).toEqual([]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("transcribes 70 seconds in three 30-second windows, with words from every window", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  await choose(page, LONG());
  await start(page).click();
  await expect(workspace(page)).toHaveAttribute("data-state", "done", DONE);
  await expect(page.locator("#speech-to-text-summary")).toHaveText(
    "gettysburg-70s.wav: 1:10, heard in 3 parts of up to 30 seconds",
  );
  console.log(`speech-to-text 70 s: ${await output(page).inputValue()}`);
  // 0 to 30 s, 30 to 60 s, 60 to 70 s.
  await expectWords(page, ["brought forth", "created equal"]);
  await expectWords(page, ["resting place", "consecrate"]);
  await expectWords(page, ["never forget"]);
  expect(errors).toEqual([]);
});

test("refuses a recording over three minutes and a file that is not audio, before any download", async ({
  page,
}) => {
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.locator("#speech-to-text-error")).toHaveText(MESSAGES.notAudio);

  // 3 minutes and 1 second of a quiet tone, 8 kHz mono: 2.9 MB.
  await input(page).setInputFiles(wav("long.wav", sineWav(181, 8000, 1)));
  await expect(page.locator("#speech-to-text-error")).toHaveText(MESSAGES.tooLong(181), {
    timeout: 60_000,
  });
  await expect(page.locator("#speech-to-text-error")).toHaveText(
    "This recording is 3:01 long. The limit is 3 minutes: cut it into shorter parts first.",
  );
  expect(requests.models()).toEqual([]);
});

/** Holds every request for the decoder's second part until released, and says when one came. */
async function holdPart(page: Page) {
  const held: Route[] = [];
  let arrived: () => void = () => {};
  const came = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(`**${MODEL.decoderParts[1].url}`, (route) => {
    held.push(route);
    arrived();
  });
  return {
    came,
    release: async () => {
      await page.unroute(`**${MODEL.decoderParts[1].url}`);
      for (const route of held) await route.abort().catch(() => {});
    },
  };
}

test("Cancel during the download stops it, keeps nothing, and Retry downloads and transcribes", async ({
  page,
}) => {
  await openTool(page, PATH);
  await choose(page, SHORT());
  const part = await holdPart(page);
  await start(page).click();
  await part.came;
  await expect(page.locator("#speech-to-text-stage")).toHaveText("Downloading the model");
  await page.locator("#speech-to-text-cancel").click();
  await expect(workspace(page)).toHaveAttribute("data-state", "stopped");
  await expect(page.locator("#speech-to-text-stopped")).toHaveText(
    "Nothing was kept. Press Retry to start again.",
  );
  await expect(start(page)).toHaveText("Retry");
  await part.release();

  // Nothing was kept: the model is not loaded, so a new file asks for the download again.
  await choose(page, SHORT());
  await expect(start(page)).toHaveText("Download the model (39.9 MB) and transcribe");
  await start(page).click();
  await expect(workspace(page)).toHaveAttribute("data-state", "done", DONE);
  await expectWords(page, ["brought forth", "created equal"]);
});

test("a decoder part that does not match its hash is refused, and Retry then works", async ({
  page,
}) => {
  await openTool(page, PATH);
  await choose(page, SHORT());
  const url = `**${MODEL.decoderParts[0].url}`;
  // The right size, the wrong bytes.
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.alloc(MODEL.decoderParts[0].bytes, 7),
    }),
  );
  await start(page).click();
  await expect(workspace(page)).toHaveAttribute("data-state", "error", DONE);
  await expect(page.locator("#speech-to-text-error")).toHaveText(MESSAGES.modelFailed);
  await page.unroute(url);
  await page.locator("#speech-to-text-retry").click();
  await expect(workspace(page)).toHaveAttribute("data-state", "done", DONE);
  await expectWords(page, ["brought forth", "created equal"]);
});

test("Cancel during the transcription stops it and shows no text", async ({ page }) => {
  await openTool(page, PATH);
  await choose(page, LONG());
  await start(page).click();
  await expect(page.locator("#speech-to-text-stage")).toHaveText("Transcribing part 2 of 3", DONE);
  await page.locator("#speech-to-text-cancel").click();
  await expect(workspace(page)).toHaveAttribute("data-state", "stopped");
  await expect(output(page)).toHaveCount(0);
  await expect(start(page)).toHaveText("Retry");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await choose(page, SHORT());
    await expectNoAxeViolations(page);
    await input(page).setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("text"),
    });
    await expect(page.locator("#speech-to-text-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
