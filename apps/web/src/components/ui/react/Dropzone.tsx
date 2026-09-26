import { type DragEvent, useState } from "react";
import { type DropzoneState, dropzoneAttrs } from "../attrs";
import { Icon } from "./Icon";

export interface DropzoneProps {
  /** The id of the file input. */
  id?: string;
  /** Forces a state; left out, the zone shows "active" while files are dragged over it. */
  state?: DropzoneState;
  disabled?: boolean;
  multiple?: boolean;
  accept?: string;
  title?: string;
  hint?: string;
  /** The files the visitor dropped or picked, in their order. Never called with an empty list. */
  onFiles?: (files: File[]) => void;
}

/**
 * The file input of a tool. The real <input type="file"> keeps it keyboard accessible (the label
 * opens the picker) and works without drag and drop. Dropping files on it and picking them both
 * call `onFiles`; the zone never reads the files itself. Validation belongs to the tool, which
 * knows its limits.
 */
export function Dropzone({
  id,
  state,
  disabled = false,
  multiple = true,
  accept,
  title = "Drop files here",
  hint = "or click to browse",
  onFiles,
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const shown: DropzoneState = state ?? (dragging && !disabled ? "active" : "idle");

  const give = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles?.(multiple ? files : files.slice(0, 1));
  };
  const over = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    // Without preventDefault the browser opens the dropped file instead of handing it over.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  return (
    <label
      className="ni-dropzone"
      {...dropzoneAttrs({ state: shown, disabled })}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        give(event.dataTransfer.files);
      }}
    >
      <input
        className="sr-only"
        id={id}
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          give(event.currentTarget.files);
          // Cleared, so picking the same file again still reports it.
          event.currentTarget.value = "";
        }}
      />
      <span className="ni-dropzone__icon">
        <Icon name="upload" size="lg" />
      </span>
      <span className="ni-dropzone__title">{title}</span>
      <span className="ni-dropzone__hint">{hint}</span>
    </label>
  );
}
