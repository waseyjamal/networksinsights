import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { cx } from "../attrs";

// A page with things placed on it, such as a PDF page with text and boxes added. The page is a
// picture; each item is a button over it, placed and sized as fractions of the page (0 to 1 from
// the top left), so it keeps its place at any width. An item moves by dragging with a mouse, a
// finger or a pen, or with the arrow keys once it has focus (Shift moves ten times as far), and
// Delete or Backspace removes it. In draw mode a stroke on the page is reported as points instead;
// drawing has no keyboard path, so a tool that offers it must offer other items too. Text inside an
// item can be sized in `cqw`, a hundredth of the page's width, so it scales with the page.

export interface PageCanvasItem {
  id: string;
  /** What the item is, for a screen reader: "Text: Approved". */
  label: string;
  x: number;
  y: number;
  /** Fractions of the page; leave out to let the content decide. */
  width?: number | undefined;
  height?: number | undefined;
  content: ReactNode;
}

export interface PageCanvasPoint {
  x: number;
  y: number;
}

export interface PageCanvasProps {
  id: string;
  label: string;
  hint?: string | undefined;
  /** The page picture; nothing shows an empty sheet. */
  src?: string | undefined;
  /** Width divided by height of the page as it is seen. */
  aspectRatio?: number | undefined;
  items?: readonly PageCanvasItem[] | undefined;
  selectedId?: string | null | undefined;
  /** "draw" reports strokes on the page instead of moving items. */
  mode?: "select" | "draw" | undefined;
  className?: string | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  onMove?: ((id: string, x: number, y: number) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  onStroke?: ((points: PageCanvasPoint[]) => void) | undefined;
}

/** How far one arrow key press moves an item, as a fraction of the page. */
export const PAGE_CANVAS_STEP = 0.01;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function PageCanvas({
  id,
  label,
  hint,
  src,
  aspectRatio = 1 / Math.SQRT2,
  items = [],
  selectedId = null,
  mode = "select",
  className,
  onSelect,
  onMove,
  onDelete,
  onStroke,
}: PageCanvasProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [stroke, setStroke] = useState<PageCanvasPoint[] | null>(null);

  const at = (event: PointerEvent): PageCanvasPoint => {
    const box = pageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  };

  const pageDown = (event: PointerEvent<HTMLDivElement>) => {
    if (mode !== "draw") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setStroke([at(event)]);
  };
  const pageMove = (event: PointerEvent<HTMLDivElement>) => {
    if (mode === "draw" && stroke) setStroke([...stroke, at(event)]);
  };
  const pageUp = () => {
    if (mode !== "draw" || !stroke) return;
    if (stroke.length > 0) onStroke?.(stroke);
    setStroke(null);
  };

  const itemDown = (event: PointerEvent<HTMLButtonElement>, item: PageCanvasItem) => {
    if (mode === "draw") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    drag.current = { id: item.id, dx: point.x - item.x, dy: point.y - item.y };
    onSelect?.(item.id);
  };
  const itemMove = (event: PointerEvent<HTMLButtonElement>) => {
    const moving = drag.current;
    if (!moving) return;
    const point = at(event);
    onMove?.(moving.id, clamp(point.x - moving.dx), clamp(point.y - moving.dy));
  };
  const itemUp = () => {
    drag.current = null;
  };
  const itemKey = (event: KeyboardEvent<HTMLButtonElement>, item: PageCanvasItem) => {
    const step = event.shiftKey ? PAGE_CANVAS_STEP * 10 : PAGE_CANVAS_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      onMove?.(item.id, clamp(item.x + move[0]), clamp(item.y + move[1]));
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete?.(item.id);
    }
  };

  // Rounded to a hundredth of a percent, so 0.1 + 0.01 shows as 11%, not 11.000000000000002%.
  const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;

  return (
    <div className={cx("ni-field ni-pagecanvas", className)}>
      <p className="ni-field__label" id={`${id}-label`}>
        {label}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset cannot hold a picture of a fixed aspect ratio with items over it; group names the page */}
      <div
        ref={pageRef}
        className="ni-pagecanvas__page"
        id={id}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-mode={mode}
        style={{ aspectRatio: String(aspectRatio) }}
        onPointerDown={pageDown}
        onPointerMove={pageMove}
        onPointerUp={pageUp}
        onPointerCancel={pageUp}
      >
        {src && <img className="ni-pagecanvas__image" src={src} alt="" draggable={false} />}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ni-pagecanvas__item"
            aria-label={item.label}
            aria-pressed={item.id === selectedId}
            style={{
              left: percent(item.x),
              top: percent(item.y),
              width: item.width === undefined ? undefined : percent(item.width),
              height: item.height === undefined ? undefined : percent(item.height),
            }}
            onPointerDown={(event) => itemDown(event, item)}
            onPointerMove={itemMove}
            onPointerUp={itemUp}
            onPointerCancel={itemUp}
            onFocus={() => onSelect?.(item.id)}
            onKeyDown={(event) => itemKey(event, item)}
          >
            {item.content}
          </button>
        ))}
        {stroke && stroke.length > 1 && (
          <svg
            className="ni-pagecanvas__stroke"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={stroke.map((point) => `${point.x},${point.y}`).join(" ")} />
          </svg>
        )}
      </div>
      {hint && (
        <p className="ni-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
