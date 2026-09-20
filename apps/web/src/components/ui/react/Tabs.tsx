import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cx, nextTabIndex, type TabItem, tabAttrs, tabPanelAttrs } from "../attrs";

export interface TabsProps {
  /** Unique on the page. Prefix of all element ids. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  tabs: Array<TabItem & { panel: ReactNode }>;
  defaultSelected?: string;
  className?: string;
}

/** WAI-ARIA Tabs pattern: roving tabindex, arrow keys, Home and End, automatic activation. */
export function Tabs({ id, label, tabs, defaultSelected, className }: TabsProps) {
  const [selected, setSelected] = useState(defaultSelected ?? tabs[0]?.id);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    const tab = next === null ? undefined : tabs[next];
    if (next === null || !tab) return;
    event.preventDefault();
    setSelected(tab.id);
    buttons.current[next]?.focus();
  };

  return (
    <div className={cx("ni-tabs", className)}>
      <div className="ni-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            className="ni-tab"
            onClick={() => setSelected(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            {...tabAttrs(id, tab.id, tab.id === selected)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="ni-tabpanel"
          hidden={tab.id !== selected}
          {...tabPanelAttrs(id, tab.id)}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
