import type { InputHTMLAttributes } from "react";
import { controlAttrs, cx } from "../attrs";
import { Field } from "./Field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Input({ id, label, hint, error, className, ...rest }: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        className={cx("ni-input", className)}
        id={id}
        {...controlAttrs({ id, hint, error })}
        {...rest}
      />
    </Field>
  );
}
