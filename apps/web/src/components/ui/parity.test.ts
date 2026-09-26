// Every component exists twice (Astro and React) but styles live once, in components.css.
// This test renders both versions with the same input and fails if the markup differs, so the
// two can never drift apart on class names, data attributes, ARIA or structure.

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import Alert from "./Alert.astro";
import Badge from "./Badge.astro";
import Button from "./Button.astro";
import Card from "./Card.astro";
import Checkbox from "./Checkbox.astro";
import Dropzone from "./Dropzone.astro";
import Icon from "./Icon.astro";
import Input from "./Input.astro";
import Kbd from "./Kbd.astro";
import Progress from "./Progress.astro";
import {
  Alert as ReactAlert,
  Badge as ReactBadge,
  Button as ReactButton,
  ButtonLink as ReactButtonLink,
  Card as ReactCard,
  CardLink as ReactCardLink,
  Checkbox as ReactCheckbox,
  Dropzone as ReactDropzone,
  Icon as ReactIcon,
  Input as ReactInput,
  Kbd as ReactKbd,
  Progress as ReactProgress,
  Select as ReactSelect,
  Skeleton as ReactSkeleton,
  StatGrid as ReactStatGrid,
  Switch as ReactSwitch,
  Tabs as ReactTabs,
  Textarea as ReactTextarea,
  Tooltip as ReactTooltip,
  ToolWorkspace as ReactToolWorkspace,
} from "./react";
import Select from "./Select.astro";
import Skeleton from "./Skeleton.astro";
import StatGrid from "./StatGrid.astro";
import Switch from "./Switch.astro";
import TabPanel from "./TabPanel.astro";
import Tabs from "./Tabs.astro";
import Textarea from "./Textarea.astro";
import Tooltip from "./Tooltip.astro";
import ToolWorkspace from "./ToolWorkspace.astro";

/**
 * Reduces markup to a comparable form: tag names, sorted attributes, collapsed whitespace.
 * data-ni-* attributes are hooks for the small scripts of the Astro components (Tabs). They carry
 * no style and no meaning, and React does its own wiring, so they are left out of the comparison.
 */
function normalize(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(
      /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g,
      (_m, close, tag, attrs) => {
        if (close) return `</${tag.toLowerCase()}>`;
        const list = [...String(attrs).matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)].map(
          ([, name, value]) => {
            const key = String(name).toLowerCase();
            if (key.startsWith("data-ni-")) return "";
            let v = value ?? "";
            if (key === "class") v = v.split(/\s+/).filter(Boolean).sort().join(" ");
            if (key === "style")
              v = v
                .replace(/\s*:\s*/g, ":")
                .replace(/;\s*$/, "")
                .trim();
            return `${key}="${v}"`;
          },
        );
        const kept = list.filter(Boolean).sort();
        return `<${tag.toLowerCase()}${kept.length ? ` ${kept.join(" ")}` : ""}>`;
      },
    )
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}

let container: Awaited<ReturnType<typeof AstroContainer.create>>;
beforeAll(async () => {
  container = await AstroContainer.create();
});

// biome-ignore lint/suspicious/noExplicitAny: Astro component types are not exported as one type
type AstroComponent = any;

async function astro(
  component: AstroComponent,
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  return normalize(await container.renderToString(component, { props, slots }));
}

const react = (element: ReactElement) => normalize(renderToStaticMarkup(element));

describe("Astro and React components emit the same markup", () => {
  it("Icon", async () => {
    expect(await astro(Icon, { name: "search", size: "sm" })).toBe(
      react(createElement(ReactIcon, { name: "search", size: "sm" })),
    );
  });

  it.each([
    [{ variant: "primary", size: "lg" }],
    [{ variant: "danger" }],
    [{ variant: "ghost", size: "sm", loading: true }],
    [{}],
  ])("Button %j", async (props) => {
    expect(await astro(Button, props, { default: "Go" })).toBe(
      react(createElement(ReactButton, props as never, "Go")),
    );
  });

  it("Button as a link", async () => {
    expect(await astro(Button, { href: "/x", variant: "secondary" }, { default: "Go" })).toBe(
      react(createElement(ReactButtonLink, { href: "/x", variant: "secondary" }, "Go")),
    );
  });

  it.each(["neutral", "brand", "success", "warning", "danger", "info"])(
    "Badge %s",
    async (tone) => {
      expect(await astro(Badge, { tone }, { default: "New" })).toBe(
        react(createElement(ReactBadge, { tone: tone as never }, "New")),
      );
    },
  );

  it("Card and Card as a link", async () => {
    expect(await astro(Card, { padding: "lg" }, { default: "Body" })).toBe(
      react(createElement(ReactCard, { padding: "lg" }, "Body")),
    );
    expect(await astro(Card, { href: "/x" }, { default: "Body" })).toBe(
      react(createElement(ReactCardLink, { href: "/x" }, "Body")),
    );
  });

  it("Kbd", async () => {
    expect(await astro(Kbd, {}, { default: "Ctrl" })).toBe(
      react(createElement(ReactKbd, null, "Ctrl")),
    );
  });

  it.each(["info", "success", "warning", "danger"])("Alert %s", async (tone) => {
    expect(await astro(Alert, { tone, title: "Title" }, { default: "Body" })).toBe(
      react(createElement(ReactAlert, { tone: tone as never, title: "Title" }, "Body")),
    );
  });

  it("Progress, determinate and indeterminate", async () => {
    expect(await astro(Progress, { value: 42, label: "Loading" })).toBe(
      react(createElement(ReactProgress, { value: 42, label: "Loading" })),
    );
    expect(await astro(Progress, { label: "Loading" })).toBe(
      react(createElement(ReactProgress, { label: "Loading" })),
    );
  });

  it("Skeleton", async () => {
    expect(await astro(Skeleton, { shape: "circle" })).toBe(
      react(createElement(ReactSkeleton, { shape: "circle" })),
    );
  });

  it("Input with a label, hint and error", async () => {
    const props = {
      id: "f",
      label: "Name",
      hint: "Your name",
      error: "Required",
      placeholder: "Ada",
    };
    expect(await astro(Input, props)).toBe(react(createElement(ReactInput, props)));
  });

  it("Textarea", async () => {
    const props = { id: "t", label: "Note", hint: "Optional", rows: 3 };
    expect(await astro(Textarea, props)).toBe(react(createElement(ReactTextarea, props)));
  });

  it("Select", async () => {
    const props = { id: "s", label: "Format" };
    expect(await astro(Select, props, { default: "<option>A</option><option>B</option>" })).toBe(
      react(
        createElement(
          ReactSelect,
          props,
          createElement("option", null, "A"),
          createElement("option", null, "B"),
        ),
      ),
    );
  });

  it("Checkbox and Switch", async () => {
    expect(await astro(Checkbox, { label: "Keep", checked: true })).toBe(
      react(createElement(ReactCheckbox, { label: "Keep", defaultChecked: true })),
    );
    expect(await astro(Switch, { label: "Notify", disabled: true })).toBe(
      react(createElement(ReactSwitch, { label: "Notify", disabled: true })),
    );
  });

  it("Dropzone", async () => {
    const props = {
      state: "error",
      disabled: true,
      accept: "image/*",
      title: "Drop",
      hint: "Or click",
    };
    expect(await astro(Dropzone, props)).toBe(react(createElement(ReactDropzone, props as never)));
  });

  it("Tooltip", async () => {
    expect(
      await astro(
        Tooltip,
        { id: "tip", text: "Hi", side: "bottom" },
        { default: '<button type="button">x</button>' },
      ),
    ).toBe(
      react(
        createElement(
          ReactTooltip,
          { id: "tip", text: "Hi", side: "bottom" } as never,
          createElement("button", { type: "button" }, "x"),
        ),
      ),
    );
  });

  it("Tabs", async () => {
    const tabs = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const panelA = await container.renderToString(TabPanel, {
      props: { tabs: "t", id: "a", selected: true },
      slots: { default: "One" },
    });
    const panelB = await container.renderToString(TabPanel, {
      props: { tabs: "t", id: "b" },
      slots: { default: "Two" },
    });
    expect(await astro(Tabs, { id: "t", label: "Demo", tabs }, { default: panelA + panelB })).toBe(
      react(
        createElement(ReactTabs, {
          id: "t",
          label: "Demo",
          tabs: tabs.map((tab, i) => ({ ...tab, panel: i === 0 ? "One" : "Two" })),
        }),
      ),
    );
  });

  it("StatGrid", async () => {
    const items = [
      { id: "words", label: "Words", value: "1,234" },
      { label: "Reading time", value: "5 min 11 sec" },
    ];
    expect(await astro(StatGrid, { items })).toBe(react(createElement(ReactStatGrid, { items })));
  });

  it("ToolWorkspace", async () => {
    expect(
      await astro(
        ToolWorkspace,
        { id: "w", title: "Compress", description: "Shrink files" },
        {
          default: "<p>Body</p>",
          badge: "<span>Beta</span>",
          actions: '<button type="button">Go</button>',
          result: "<p>Done</p>",
        },
      ),
    ).toBe(
      react(
        createElement(
          ReactToolWorkspace,
          {
            id: "w",
            title: "Compress",
            description: "Shrink files",
            badge: createElement("span", null, "Beta"),
            actions: createElement("button", { type: "button" }, "Go"),
            result: createElement("p", null, "Done"),
          },
          createElement("p", null, "Body"),
        ),
      ),
    );
  });
});
