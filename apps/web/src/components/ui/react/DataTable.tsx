export interface DataTableProps {
  /** Required. It is the `id` of the <table>. */
  id: string;
  /** Names the table for screen readers, as its caption and as the name of the scrolling region. */
  label: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

/** A table of figures: the first column is the row header, the others are right-aligned figures. */
export function DataTable({ id, label, columns, rows }: DataTableProps) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be focusable to be reached by keyboard
    <section className="ni-table" aria-label={label} tabIndex={0}>
      <table id={id}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows are a fixed ordered list
            <tr key={rowIndex}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th scope="row" key={columns[index]}>
                    {cell}
                  </th>
                ) : (
                  <td key={columns[index]}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
