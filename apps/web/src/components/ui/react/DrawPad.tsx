import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { cx } from "../attrs";

// A surface to draw on with a mouse, a finger or a pen, such as a signature. The ink colour comes
// from the CSS `color` of the canvas (the theme's text colour), so it shows in both themes; the
// canvas background is CSS only, so the drawing itself is ink on transparent. A tool that keeps
// the drawing reads its shape (the alpha) and colours it as it needs, such as black for a PDF.
// Drawing cannot be done with a keyboard: a tool that offers it must offer another way too.

export interface DrawPadHandle {
  /** The canvas, to read the drawing from. */
  canvas: HTMLCanvasElement | null;
  /** Wipes the drawing. */
  clear: () => void;
}

export interface DrawPadProps {
  id: string;
  label: string;
  hint?: string | undefined;
  /** Height of the surface in CSS pixels. */
  height?: number | undefined;
  className?: string | undefined;
  /** Called with true after a stroke, and with false after `clear()`. */
  onChange?: ((hasInk: boolean) => void) | undefined;
  handle?: Ref<DrawPadHandle> | undefined;
}

export function DrawPad({
  id,
  label,
  hint,
  height = 160,
  className,
  onChange,
  handle,
}: DrawPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(
    handle,
    () => ({
      get canvas() {
        return canvasRef.current;
      },
      clear() {
        const canvas = canvasRef.current;
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        onChangeRef.current?.(false);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.5 * ratio;

    let last: { x: number; y: number } | null = null;
    const point = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) / box.width) * canvas.width,
        y: ((event.clientY - box.top) / box.height) * canvas.height,
      };
    };
    const down = (event: PointerEvent) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      context.strokeStyle = getComputedStyle(canvas).color;
      last = point(event);
      context.beginPath();
      context.arc(last.x, last.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fillStyle = context.strokeStyle;
      context.fill();
    };
    const move = (event: PointerEvent) => {
      if (!last) return;
      const next = point(event);
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      last = next;
    };
    const up = () => {
      if (!last) return;
      last = null;
      onChangeRef.current?.(true);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div className={cx("ni-field ni-drawpad", className)}>
      <p className="ni-field__label" id={`${id}-label`}>
        {label}
      </p>
      <canvas
        ref={canvasRef}
        className="ni-drawpad__canvas"
        id={id}
        role="img"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ height: `${height}px` }}
      />
      {hint && (
        <p className="ni-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
