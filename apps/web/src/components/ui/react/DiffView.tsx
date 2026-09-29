import { type DiffRow, diffKind } from "../attrs";

export interface DiffViewProps {
  /** Required. It is the `id` of the list of lines. */
  id: string;
  label: string;
  rows: readonly DiffRow[];
}

/** Two texts compared, line by line: added, removed and unchanged lines, each with its sign and numbers. */
export function DiffView({ id, label, rows }: DiffViewProps) {
  return (
    <figure className="ni-diff">
      <figcaption className="ni-diff__label">{label}</figcaption>
      <ol className="ni-diff__body" id={id}>
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the rows are a fixed ordered list
          <li className="ni-diff__row" data-kind={row.kind} key={index}>
            <span className="ni-diff__num" aria-hidden="true">
              {row.oldLine}
            </span>
            <span className="ni-diff__num" aria-hidden="true">
              {row.newLine}
            </span>
            <span className="ni-diff__sign" aria-hidden="true">
              {diffKind[row.kind].sign}
            </span>
            <span className="ni-diff__text">
              <span className="sr-only">{diffKind[row.kind].label}: </span>
              {row.text}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
