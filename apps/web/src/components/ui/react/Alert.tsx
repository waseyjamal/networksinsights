import type { HTMLAttributes } from "react";
import { type AlertTone, alertAttrs, alertIcon, cx } from "../attrs";
import { Icon } from "./Icon";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps) {
  return (
    <div className={cx("ni-alert", className)} {...alertAttrs({ tone })} {...rest}>
      <Icon name={alertIcon[tone]} />
      <div>
        {title && <p className="ni-alert__title">{title}</p>}
        <div className="ni-alert__body">{children}</div>
      </div>
    </div>
  );
}
