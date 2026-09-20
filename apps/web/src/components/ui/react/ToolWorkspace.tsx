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
      <div className="ni-workspace__actions">{actions}</div>
      <div className="ni-workspace__result" aria-live="polite">
        <p className="ni-workspace__result-label">Result</p>
        {result}
      </div>
      <div className="ni-workspace__footer">
        <Badge tone="success">
          <Icon name="lock" size="sm" />
          {PRIVACY_TEXT}
        </Badge>
      </div>
    </section>
  );
}
