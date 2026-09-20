import type { SelectHTMLAttributes } from "react";
import { controlAttrs, cx } from "../attrs";
import { Field } from "./Field";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Select({ id, label, hint, error, className, children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="ni-select-wrap">
        <select
          className={cx("ni-select", className)}
          id={id}
          {...controlAttrs({ id, hint, error })}
          {...rest}
        >
          {children}
        </select>
      </div>
    </Field>
  );
}
