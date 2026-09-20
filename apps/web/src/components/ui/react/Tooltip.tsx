import { type ReactNode, useState } from "react";
import { type TooltipSide, tooltipAttrs } from "../attrs";

export interface TooltipProps {
  /** Unique on the page. The trigger points to it with aria-describedby. */
  id: string;
  text: string;
  side?: TooltipSide;
  /** The trigger. It must carry aria-describedby={id}, so screen readers announce the text. */
  children: ReactNode;
}

/** Shows on hover and keyboard focus, stays open while the pointer is on it, Esc dismisses it. */
export function Tooltip({ id, text, side, children }: TooltipProps) {
  const [dismissed, setDismissed] = useState(false);
  return (
    // The wrapper only listens for Esc: focus and the pointer stay on the trigger inside it.
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc handler of the tooltip pattern
    <span
      className="ni-tooltip"
      {...tooltipAttrs({ side })}
      {...(dismissed ? { "data-dismissed": "true" } : {})}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
      onPointerOut={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {children}
      <span className="ni-tooltip__content" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
