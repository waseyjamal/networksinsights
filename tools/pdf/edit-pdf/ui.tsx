import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Input,
  PageCanvas,
  type PageCanvasItem,
  type PageCanvasPoint,
  Progress,
  Select,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  type Box,
  COLORS,
  type Color,
  checkFile,
  checkPicture,
  checkText,
  clampBox,
  FONTS,
  type Font,
  formatSize,
  HIGHLIGHT,
  type Item,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  moveStrokes,
  outputName,
  type PageView,
  PEN_WIDTH,
  type Picture,
  pictureBox,
  pictureType,
  strokesBox,
  TEXT_SIZES,
} from "./logic";

// The workspace of Edit PDF. The worker opens the PDF and draws one page at a time as a picture;
// this page lays the visitor's items over it with PageCanvas, as fractions of the page, and sends
// them to the worker to be drawn into the PDF with pdf-lib on save. PDF.js and pdf-lib load in the
// worker on the first PDF, never with the page (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const expected = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

interface Shown extends PageView {
  url: string;
}

type Added = Picture & { url: string };

const KIND_NAMES: Record<Item["kind"], string> = {
  text: "Text",
  image: "Picture",
  drawing: "Drawing",
  highlight: "Highlight",
  whitebox: "White box",
};

async function pictureSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [shown, setShown] = useState<Shown | null>(null);
  const [opening, setOpening] = useState(false);
  const [fileError, setFileError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pictures, setPictures] = useState<Added[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [pictureError, setPictureError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const [status, setStatus] = useState("");
  const counter = useRef(0);
  const nextId = () => `item-${++counter.current}`;

  // Draws the page shown, and frees the picture of the page before.
  useEffect(() => {
    if (!file || pages === 0) return;
    let cancelled = false;
    void client
      .run({ kind: "render", page: pageNo })
      .then((answer) => {
        if (cancelled || answer.kind !== "render") return;
        setShown({ ...answer.view, url: URL.createObjectURL(answer.view.blob) });
      })
      .catch((caught) => {
        if (!cancelled) setError(expected(caught, MESSAGES.renderFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [file, pages, pageNo]);
  useEffect(
    () => () => {
      if (shown) URL.revokeObjectURL(shown.url);
    },
    [shown],
  );

  const changed = () => {
    setResult(null);
    setStatus("");
  };

  const choose = async (files: File[]) => {
    const chosen = files[0];
    if (!chosen) return;
    const refused = checkFile(chosen);
    setFile(null);
    setPages(0);
    setShown(null);
    setItems([]);
    setPictures([]);
    setSelectedId(null);
    setResult(null);
    setError("");
    if (refused) {
      setFileError(`${chosen.name}: ${refused}`);
      return;
    }
    setFileError("");
    setOpening(true);
    try {
      const answer = await client.run({ kind: "open", file: chosen });
      if (answer.kind !== "open") return;
      setPageNo(1);
      setPages(answer.pages);
      setFile(chosen);
    } catch (caught) {
      setFileError(`${chosen.name}: ${expected(caught, MESSAGES.unreadable)}`);
    } finally {
      setOpening(false);
    }
  };

  const add = (item: Item) => {
    setItems((current) => [...current, item]);
    setSelectedId(item.id);
    changed();
  };

  const update = (id: string, change: (item: Item) => Item) => {
    setItems((current) => current.map((item) => (item.id === id ? change(item) : item)));
    changed();
  };

  const remove = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    changed();
  };

  const addBox = (kind: "highlight" | "whitebox") =>
    add({ kind, id: nextId(), page: pageNo, box: { x: 0.1, y: 0.1, width: 0.4, height: 0.05 } });

  const addPicture = async (files: File[]) => {
    const chosen = files[0];
    if (!chosen || !shown) return;
    const problem = checkPicture(chosen);
    const type = pictureType(chosen);
    if (problem || !type) {
      setPictureError(`${chosen.name}: ${problem ?? MESSAGES.notPicture}`);
      return;
    }
    setPictureError("");
    let size: { width: number; height: number };
    try {
      size = await pictureSize(chosen);
    } catch {
      setPictureError(`${chosen.name}: ${MESSAGES.notPicture}`);
      return;
    }
    const id = nextId();
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    setPictures((current) => [
      ...current,
      { id, bytes, type, ...size, url: URL.createObjectURL(chosen) },
    ]);
    add({
      kind: "image",
      id: nextId(),
      page: pageNo,
      imageId: id,
      box: pictureBox(size, { width: shown.seenWidth, height: shown.seenHeight }, 0.3),
    });
  };

  const stroke = (points: PageCanvasPoint[]) =>
    add({ kind: "drawing", id: nextId(), page: pageNo, strokes: [points], color: "blue" });

  const move = (id: string, x: number, y: number) =>
    update(id, (item) => {
      if (item.kind === "text") return { ...item, x, y };
      if (item.kind === "drawing") {
        const box = strokesBox(item.strokes);
        const to = clampBox({
          ...box,
          x,
          y,
          width: Math.max(box.width, 0.01),
          height: Math.max(box.height, 0.01),
        });
        return { ...item, strokes: moveStrokes(item.strokes, to.x - box.x, to.y - box.y) };
      }
      return { ...item, box: clampBox({ ...item.box, x, y }) };
    });

  const problems = items
    .filter((item): item is Extract<Item, { kind: "text" }> => item.kind === "text")
    .map((item) => ({ item, problem: checkText(item.text) }))
    .filter((entry) => entry.problem !== null);

  const save = async () => {
    if (!file || problems.length > 0) return;
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const answer = await client.run({
        kind: "save",
        file,
        items,
        pictures: pictures.map(({ url: _url, ...picture }) => picture),
      });
      if (answer.kind !== "save") return;
      setResult({ blob: answer.blob, name: outputName(file.name) });
      setStatus("The edited PDF is ready.");
    } catch (caught) {
      setError(expected(caught, MESSAGES.failed));
    } finally {
      setSaving(false);
    }
  };

  const seenWidth = shown?.seenWidth ?? 1;
  const fontSize = (size: number) => `${(size / seenWidth) * 100}cqw`;
  const onPage = items.filter((item) => item.page === pageNo);
  const canvasItems: PageCanvasItem[] = onPage.map((item) => {
    const name = KIND_NAMES[item.kind];
    if (item.kind === "text")
      return {
        id: item.id,
        label: `${name}: ${item.text || "empty"}`,
        x: item.x,
        y: item.y,
        content: (
          <span
            style={{
              fontFamily: FONTS[item.font].css,
              fontSize: fontSize(item.size),
              color: COLORS[item.color].css,
            }}
          >
            {item.text || " "}
          </span>
        ),
      };
    if (item.kind === "drawing") {
      const box = strokesBox(item.strokes);
      const width = Math.max(box.width, 0.01);
      const height = Math.max(box.height, 0.01);
      return {
        id: item.id,
        label: name,
        x: box.x,
        y: box.y,
        width,
        height,
        content: (
          <svg
            viewBox={`${box.x} ${box.y} ${width} ${height}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            aria-hidden="true"
            style={{ display: "block", overflow: "visible" }}
          >
            {item.strokes.map((points, index) => (
              <polyline
                // biome-ignore lint/suspicious/noArrayIndexKey: strokes never move within a drawing
                key={index}
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={COLORS[item.color].css}
                strokeWidth={fontSize(PEN_WIDTH)}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        ),
      };
    }
    const box: Box = item.box;
    const picture =
      item.kind === "image" ? pictures.find((entry) => entry.id === item.imageId) : null;
    return {
      id: item.id,
      label: name,
      ...box,
      content:
        item.kind === "image" ? (
          <img
            src={picture?.url}
            alt=""
            style={{ display: "block", width: "100%", height: "100%" }}
          />
        ) : (
          <span
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              background: item.kind === "highlight" ? HIGHLIGHT.css : "#ffffff",
              boxShadow:
                item.kind === "whitebox" ? "inset 0 0 0 1px rgba(0, 0, 0, 0.3)" : undefined,
            }}
          />
        ),
    };
  });
  const selected = onPage.find((item) => item.id === selectedId) ?? null;

  const percentField = (
    id: string,
    label: string,
    value: number,
    apply: (fraction: number) => void,
  ) => (
    <Input
      id={id}
      label={label}
      type="number"
      min={1}
      max={100}
      value={String(Math.round(value * 100))}
      onChange={(event) => {
        const number = Number(event.target.value);
        if (Number.isFinite(number) && number >= 1 && number <= 100) apply(number / 100);
      }}
    />
  );

  return (
    <>
      <Dropzone
        id="edit-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)} and ${LIMITS.maxPages} pages`}
        onFiles={(files) => void choose(files)}
      />
      {opening && <Progress label="Opening the PDF" />}
      {fileError && (
        <Alert tone="warning" title="This PDF was not opened">
          {fileError}
        </Alert>
      )}

      {file && pages > 0 && (
        <>
          <Alert tone="info" title="What this tool can and cannot do" id="edit-pdf-notice">
            It adds new things on top of the pages. It cannot change or delete text that is already
            in the PDF. A white box only covers what is under it: the covered text or picture is
            still in the file, and anyone can still copy it out, so it is not redaction.
          </Alert>

          <div className="ni-workspace__actions" id="edit-pdf-pages">
            <Button
              variant="secondary"
              disabled={pageNo <= 1}
              onClick={() => setPageNo(pageNo - 1)}
            >
              Previous page
            </Button>
            <span className="text-sm" aria-live="polite">
              Page {pageNo} of {pages}
            </span>
            <Button
              variant="secondary"
              disabled={pageNo >= pages}
              onClick={() => setPageNo(pageNo + 1)}
            >
              Next page
            </Button>
          </div>

          <div className="ni-workspace__actions" id="edit-pdf-tools">
            <Button
              variant="secondary"
              onClick={() =>
                add({
                  kind: "text",
                  id: nextId(),
                  page: pageNo,
                  x: 0.1,
                  y: 0.1,
                  text: "Your text",
                  font: "helvetica",
                  size: 14,
                  color: "black",
                })
              }
            >
              Add text
            </Button>
            <Button variant="secondary" onClick={() => addBox("highlight")}>
              Add highlight
            </Button>
            <Button variant="secondary" onClick={() => addBox("whitebox")}>
              Add white box
            </Button>
            <Button
              variant={drawing ? "primary" : "secondary"}
              aria-pressed={drawing}
              onClick={() => setDrawing(!drawing)}
            >
              {drawing ? "Stop drawing" : "Draw"}
            </Button>
          </div>
          <Dropzone
            id="edit-pdf-picture"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            multiple={false}
            title="Add a picture"
            hint="JPG or PNG, up to 5 MB. It is placed near the top left; then drag it into place."
            onFiles={(files) => void addPicture(files)}
          />
          {pictureError && (
            <Alert tone="warning" title="This picture was not added">
              {pictureError}
            </Alert>
          )}

          <PageCanvas
            id="edit-pdf-page"
            label={`Page ${pageNo}`}
            hint={
              drawing
                ? "Draw on the page with a mouse, a finger or a pen. Press Stop drawing to move items again."
                : "Drag an item, or select it and move it with the arrow keys (Shift moves further). Delete removes it."
            }
            src={shown?.page === pageNo ? shown.url : undefined}
            aspectRatio={shown ? shown.seenWidth / shown.seenHeight : undefined}
            items={canvasItems}
            selectedId={selectedId}
            mode={drawing ? "draw" : "select"}
            onSelect={setSelectedId}
            onMove={move}
            onDelete={remove}
            onStroke={stroke}
          />

          {selected && (
            <div className="grid gap-3" id="edit-pdf-selected">
              <p className="text-sm">Selected: {KIND_NAMES[selected.kind]}</p>
              {selected.kind === "text" && (
                <>
                  <Textarea
                    id="edit-pdf-text"
                    label="Text"
                    rows={3}
                    maxLength={LIMITS.maxTextLength}
                    value={selected.text}
                    onChange={(event) =>
                      update(selected.id, (item) => ({ ...item, text: event.target.value }))
                    }
                  />
                  <Select
                    id="edit-pdf-font"
                    label="Font"
                    value={selected.font}
                    onChange={(event) =>
                      update(selected.id, (item) => ({ ...item, font: event.target.value as Font }))
                    }
                  >
                    {(Object.keys(FONTS) as Font[]).map((key) => (
                      <option key={key} value={key}>
                        {FONTS[key].label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    id="edit-pdf-size"
                    label="Size"
                    value={String(selected.size)}
                    onChange={(event) =>
                      update(selected.id, (item) => ({ ...item, size: Number(event.target.value) }))
                    }
                  >
                    {TEXT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size} pt
                      </option>
                    ))}
                  </Select>
                </>
              )}
              {(selected.kind === "text" || selected.kind === "drawing") && (
                <Select
                  id="edit-pdf-color"
                  label="Colour"
                  value={selected.color}
                  onChange={(event) =>
                    update(selected.id, (item) => ({ ...item, color: event.target.value as Color }))
                  }
                >
                  {(Object.keys(COLORS) as Color[]).map((key) => (
                    <option key={key} value={key}>
                      {COLORS[key].label}
                    </option>
                  ))}
                </Select>
              )}
              {(selected.kind === "highlight" ||
                selected.kind === "whitebox" ||
                selected.kind === "image") && (
                <>
                  {percentField(
                    "edit-pdf-width",
                    "Width, % of the page",
                    selected.box.width,
                    (width) =>
                      update(selected.id, (item) => {
                        if (item.kind === "text" || item.kind === "drawing") return item;
                        if (item.kind === "image") {
                          const picture = pictures.find((entry) => entry.id === item.imageId);
                          if (!picture || !shown) return item;
                          const sized = pictureBox(
                            picture,
                            { width: shown.seenWidth, height: shown.seenHeight },
                            width,
                          );
                          return {
                            ...item,
                            box: clampBox({ ...sized, x: item.box.x, y: item.box.y }),
                          };
                        }
                        return { ...item, box: clampBox({ ...item.box, width }) };
                      }),
                  )}
                  {selected.kind !== "image" &&
                    percentField(
                      "edit-pdf-height",
                      "Height, % of the page",
                      selected.box.height,
                      (height) =>
                        update(selected.id, (item) =>
                          item.kind === "highlight" || item.kind === "whitebox"
                            ? { ...item, box: clampBox({ ...item.box, height }) }
                            : item,
                        ),
                    )}
                </>
              )}
              <div className="ni-workspace__actions">
                <Button variant="danger" onClick={() => remove(selected.id)}>
                  Delete this item
                </Button>
              </div>
            </div>
          )}

          {problems.length > 0 && (
            <Alert tone="danger" title="Some text cannot be saved" id="edit-pdf-problems">
              {problems.map(({ item, problem }) => `Page ${item.page}: ${problem}`).join(" ")}
            </Alert>
          )}

          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              loading={saving}
              disabled={items.length === 0 || problems.length > 0}
              onClick={() => void save()}
            >
              Save PDF
            </Button>
          </div>
          {error && (
            <p className="text-sm text-danger-text" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="grid gap-3" id="edit-pdf-result">
              <p className="text-sm">
                {result.name}, {formatSize(result.blob.size)}
              </p>
              <div className="ni-workspace__actions">
                <Button
                  variant="primary"
                  onClick={() => saveFile(result.blob, result.name, { type: "application/pdf" })}
                >
                  Download {result.name}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-sm" aria-live="polite">
        {status}
      </p>
    </>
  );
}
