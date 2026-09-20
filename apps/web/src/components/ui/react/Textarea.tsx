import type { TextareaHTMLAttributes } from "react";
import { controlAttrs, cx } from "../attrs";
import { Field } from "./Field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Textarea({ id, label, hint, error, className, ...rest }: TextareaProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        className={cx("ni-textarea", className)}
        id={id}
        {...controlAttrs({ id, hint, error })}
        {...rest}
      />
    </Field>
  );
}
