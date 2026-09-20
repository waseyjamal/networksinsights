import type { HTMLAttributes } from "react";
import { cx } from "../attrs";

export function Kbd({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd className={cx("ni-kbd", className)} {...rest}>
      {children}
    </kbd>
  );
}
