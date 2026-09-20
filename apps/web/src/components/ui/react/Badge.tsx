import type { HTMLAttributes } from "react";
import { type BadgeTone, badgeAttrs, cx } from "../attrs";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("ni-badge", className)} {...badgeAttrs({ tone })} {...rest}>
      {children}
    </span>
  );
}
