import type { ReactNode } from "react";
import { type FileResultState, fileResultAttrs } from "../attrs";
import { Icon } from "./Icon";

export interface FileResultProps {
  name: string;
  /** One line of facts, such as "2.4 MB → 612 KB". Numbers are set in Geist Mono. */
  meta?: string | undefined;
  state?: FileResultState | undefined;
  /** A blob: or same-origin URL of the preview image. */
  previewSrc?: string | undefined;
  /** Alternative text of the preview. Required with previewSrc. */
  previewAlt?: string | undefined;
  /** Buttons for this file, such as Download. */
  actions?: ReactNode;
  /** The status under the facts: progress, or a message. */
  children?: ReactNode;
}

/** One file a tool worked on, as a row of a FileResultList. */
export function FileResult({
  name,
  meta,
  state,
  previewSrc,
  previewAlt = "",
  actions,
  children,
}: FileResultProps) {
  return (
    <li className="ni-fileresult" {...fileResultAttrs({ state })}>
      <div className="ni-fileresult__preview">
        {previewSrc ? (
          <img src={previewSrc} alt={previewAlt} loading="lazy" decoding="async" />
        ) : (
          <Icon name="image" />
        )}
      </div>
      <div className="ni-fileresult__body">
        <span className="ni-fileresult__name">{name}</span>
        {meta && <span className="ni-fileresult__meta">{meta}</span>}
        {children}
      </div>
      {actions && <div className="ni-fileresult__actions">{actions}</div>}
    </li>
  );
}

export interface FileResultListProps {
  label: string;
  children?: ReactNode;
}

/** The list of files a tool worked on. */
export function FileResultList({ label, children }: FileResultListProps) {
  return (
    <ul className="ni-fileresults" aria-label={label}>
      {children}
    </ul>
  );
}
