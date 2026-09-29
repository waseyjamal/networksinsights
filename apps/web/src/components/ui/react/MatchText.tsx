import type { MatchSegment } from "../attrs";

export interface MatchTextProps {
  /** Required. It is the `id` of the text with the matches. */
  id: string;
  label: string;
  segments: readonly MatchSegment[];
}

/** Read-only text with its matched runs highlighted. Segments arrive in order, already split. */
export function MatchText({ id, label, segments }: MatchTextProps) {
  return (
    <figure className="ni-match-text">
      <figcaption className="ni-match-text__label">{label}</figcaption>
      <pre className="ni-match-text__body" id={id}>
        {segments.map((segment, index) =>
          segment.match === undefined ? (
            segment.text
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the segments are a fixed ordered list
            <mark data-match={segment.match} key={index}>
              {segment.text}
            </mark>
          ),
        )}
      </pre>
    </figure>
  );
}
