import type { CSSProperties, HTMLAttributes } from "react";
import { cx, progressAttrs, progressPercent } from "../attrs";

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /** 0 to 100. Leave it out for an indeterminate bar. */
  value?: number;
  /** Accessible name. Required: a progress bar without a name tells nobody what is loading. */
  label: string;
}

export function Progress({ value, label, className, style, ...rest }: ProgressProps) {
  const custom = { "--ni-value": progressPercent(value), ...style } as CSSProperties;
  return (
    <div
      className={cx("ni-progress", className)}
      style={custom}
      {...progressAttrs({ value, label })}
      {...rest}
    >
      <div className="ni-progress__bar" />
    </div>
  );
}
