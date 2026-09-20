import type { HTMLAttributes } from "react";
import { cx, type SkeletonShape, skeletonAttrs } from "../attrs";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: SkeletonShape;
}

export function Skeleton({ shape, className, ...rest }: SkeletonProps) {
  return <span className={cx("ni-skeleton", className)} {...skeletonAttrs({ shape })} {...rest} />;
}
