import type { HTMLAttributes } from "react";
import { type CardPadding, cardAttrs, cx } from "../attrs";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export function Card({ padding, className, children, ...rest }: CardProps) {
  return (
    <div className={cx("ni-card", className)} {...cardAttrs({ padding })} {...rest}>
      {children}
    </div>
  );
}

export interface CardLinkProps extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
  padding?: CardPadding;
}

/** A card that is one link. Lifts on hover. */
export function CardLink({ padding, className, children, ...rest }: CardLinkProps) {
  return (
    <a
      className={cx("ni-card", className)}
      {...cardAttrs({ padding, interactive: true })}
      {...rest}
    >
      {children}
    </a>
  );
}
