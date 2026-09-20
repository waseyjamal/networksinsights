import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface FieldProps {
  /** The id of the control inside. The label and the messages are wired to it. */
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="ni-field">
      {label && (
        <label className="ni-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p className="ni-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ni-field__error" id={`${id}-error`}>
          <Icon name="alert" size="sm" />
          {error}
        </p>
      )}
    </div>
  );
}
