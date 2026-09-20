import type { InputHTMLAttributes } from "react";
import { cx } from "../attrs";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Checkbox({ label, className, children, ...rest }: CheckboxProps) {
  return (
    <label className="ni-check">
      <input className={cx("ni-checkbox", className)} type="checkbox" {...rest} />
      <span>
        {label}
        {children}
      </span>
    </label>
  );
}
