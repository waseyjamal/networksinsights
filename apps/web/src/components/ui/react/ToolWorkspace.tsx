import type { ReactNode } from "react";
import { PRIVACY_TEXT } from "../attrs";
import { Badge } from "./Badge";
import { Icon } from "./Icon";

export interface ToolWorkspaceProps {
  /** Unique on the page. */
  id: string;
  title: string;
  description?: string;
  /** Next to the title (status). */
  badge?: ReactNode;
  /** The input area: a Dropzone, fields. */
  children?: ReactNode;
  /** The primary action and secondary buttons. */
  actions?: ReactNode;
  /** The result area. Announced politely when it changes. */
  result?: ReactNode;
  /**
   * The privacy sentence in the footer. A tool page passes what privacyStatement() derives from
   * the tool's runtime; nobody writes it by hand (ADR 0034). The default is the on-device case.
   */
  privacy?: string;
  /** False when the input leaves the device, which changes the badge from a lock to an upload. */
  privacyOnDevice?: boolean;
}

/** The main tool workspace card and the only glow border on the site. */
export function ToolWorkspace({
  id,
  title,
  description,
  badge,
  children,
  actions,
  result,
  privacy = PRIVACY_TEXT,
  privacyOnDevice = true,
}: ToolWorkspaceProps) {
  return (
    <section className="ni-workspace" aria-labelledby={`${id}-title`}>
      <div className="ni-workspace__header">
        <div>
          <h2 className="ni-workspace__title" id={`${id}-title`}>
            {title}
          </h2>
          {description && <p className="ni-workspace__text">{description}</p>}
        </div>
        {badge}
      </div>
      {children}
      {actions && <div className="ni-workspace__actions">{actions}</div>}
      {result && (
        <div className="ni-workspace__result" aria-live="polite">
          <p className="ni-workspace__result-label">Result</p>
          {result}
        </div>
      )}
      <div className="ni-workspace__footer">
        <Badge tone={privacyOnDevice ? "success" : "info"}>
          <Icon name={privacyOnDevice ? "lock" : "upload"} size="sm" />
          {privacy}
        </Badge>
      </div>
    </section>
  );
}
