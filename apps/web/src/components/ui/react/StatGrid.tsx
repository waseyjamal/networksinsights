import type { StatItem } from "../attrs";

export interface StatGridProps {
  items: readonly StatItem[];
}

/** Numbers with a label, in a grid of cells: the results of a counting tool. */
export function StatGrid({ items }: StatGridProps) {
  return (
    <dl className="ni-stats">
      {items.map((item) => (
        <div className="ni-stats__item" data-stat={item.id} key={item.id ?? item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
