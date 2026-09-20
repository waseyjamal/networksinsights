import { type DropzoneState, dropzoneAttrs } from "../attrs";
import { Icon } from "./Icon";

export interface DropzoneProps {
  state?: DropzoneState;
  disabled?: boolean;
  multiple?: boolean;
  accept?: string;
  title?: string;
  hint?: string;
}

/**
 * Visual only. Dropping, validation and reading files come with the first tool.
 * The real <input type="file"> keeps it keyboard accessible: the label opens the picker.
 */
export function Dropzone({
  state,
  disabled = false,
  multiple = true,
  accept,
  title = "Drop files here",
  hint = "or click to browse",
}: DropzoneProps) {
  return (
    <label className="ni-dropzone" {...dropzoneAttrs({ state, disabled })}>
      <input
        className="sr-only"
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
      />
      <span className="ni-dropzone__icon">
        <Icon name="upload" size="lg" />
      </span>
      <span className="ni-dropzone__title">{title}</span>
      <span className="ni-dropzone__hint">{hint}</span>
    </label>
  );
}
