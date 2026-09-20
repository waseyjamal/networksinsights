import type { InputHTMLAttributes } from "react";
import { cx } from "../attrs";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  label?: string;
}

export function Switch({ label, className, children, ...rest }: SwitchProps) {
  return (
    <label className="ni-check">
      {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox already exposes its checked state to role="switch" */}
      <input className={cx("ni-switch", className)} type="checkbox" role="switch" {...rest} />
      <span>
        {label}
        {children}
      </span>
    </label>
  );
}
