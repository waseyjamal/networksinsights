// The browser side of search (ADR 0046): the dialog and the /tools/ filter.
//
// Nothing imports this file statically. The loader in SearchDialog.astro imports it with
// `import()` the first time a visitor shows intent, so a page that is only read never downloads
// it, the engine, or the index.
//
// Every string that came from a tool or from the visitor is put on the page as a text node or a
// `textContent`. There is no `innerHTML` in this file, and none may be added: the highlight
// `<mark>` elements are built from offsets, not parsed from markup (ADR 0045).

import { createEngine, type Engine, segments } from "./engine";
import { parseSearchIndex } from "./parse";
import type { FormatHint, Range, SearchHit } from "./types";

const RESULT_LIMIT = 12;
/** A screen reader is told the result count once typing pauses, not after every letter. */
const ANNOUNCE_DELAY_MS = 250;
const OPTION_ID = "ni-search-option-";

const SEL = {
  dialog: "[data-ni-search]",
  trigger: "[data-ni-search-trigger]",
} as const;

// ---------------------------------------------------------------------------------------------
// The engine, fetched once

let engine: Engine | undefined;
let loading: Promise<Engine | undefined> | undefined;

/** Fetches the index and builds the engine. A failure is not remembered: the next intent retries. */
export function loadEngine(): Promise<Engine | undefined> {
  if (engine) return Promise.resolve(engine);
  loading ??= (async () => {
    try {
      const url = document.querySelector<HTMLElement>(SEL.dialog)?.dataset.index;
      if (!url) return undefined;
      const response = await fetch(url);
      if (!response.ok) return undefined;
      const records = parseSearchIndex(await response.json());
      engine = records ? createEngine(records) : undefined;
    } catch {
      engine = undefined;
    }
    return engine;
  })().finally(() => {
    loading = undefined;
  });
  return loading;
}

// ---------------------------------------------------------------------------------------------
// Building result rows

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Puts `text` in `parent`, wrapping the matched ranges in <mark>. Text nodes only. */
function appendHighlighted(parent: HTMLElement, text: string, ranges: readonly Range[]) {
  for (const piece of segments(text, ranges)) {
    if (piece.match) {
      const mark = document.createElement("mark");
      mark.textContent = piece.text;
      parent.append(mark);
    } else {
      parent.append(document.createTextNode(piece.text));
    }
  }
}

function hintText(hint: FormatHint): string {
  return [
    hint.accepts.length > 0 ? `Accepts ${hint.accepts.join(", ")}` : "",
    hint.produces.length > 0 ? `Produces ${hint.produces.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

interface CategoryInfo {
  name: string;
  icon: Element | null;
}

// ---------------------------------------------------------------------------------------------
// The dialog

interface View {
  dialog: HTMLDialogElement;
  input: HTMLInputElement;
  results: HTMLElement;
  categories: HTMLElement;
  count: HTMLElement;
  live: HTMLElement;
  none: HTMLElement;
  empty: HTMLElement;
  error: HTMLElement;
  query: HTMLElement;
  info: Map<string, CategoryInfo>;
  opener: HTMLElement | null;
  active: number;
  /** Lets an answer that arrives late be dropped when the visitor has typed on. */
  token: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type State = "idle" | "results" | "none" | "empty" | "error";

let view: View | undefined;

function wire(): View | undefined {
  if (view) return view;
  const dialog = document.querySelector<HTMLDialogElement>(SEL.dialog);
  if (!dialog) return undefined;
  const part = <T extends HTMLElement>(name: string) =>
    dialog.querySelector<T>(`[data-ni-search-${name}]`);
  const input = part<HTMLInputElement>("input");
  const results = part("results");
  const categories = part("categories");
  const count = part("count");
  const live = part("live");
  const none = part("none");
  const empty = part("empty");
  const error = part("error");
  const query = part("query");
  if (!input || !results || !categories || !count || !live || !none || !empty || !error || !query) {
    return undefined;
  }

  // The category names and icons are in the dialog's own markup, so the index does not repeat them.
  const info = new Map<string, CategoryInfo>();
  for (const link of categories.querySelectorAll<HTMLElement>("a[data-cat]")) {
    info.set(link.dataset.cat ?? "", {
      name: link.querySelector(".ni-search__category-name")?.textContent ?? "",
      icon: link.querySelector(".ni-icon-tint svg"),
    });
  }

  const next: View = {
    dialog,
    input,
    results,
    categories,
    count,
    live,
    none,
    empty,
    error,
    query,
    info,
    opener: null,
    active: -1,
    token: 0,
    timer: undefined,
  };

  input.addEventListener("input", () => refresh(next));
  input.addEventListener("keydown", (event) => onKey(next, event));
  results.addEventListener("pointermove", (event) => {
    const option = (event.target as Element).closest("[role=option]");
    const index = option ? [...results.children].indexOf(option) : -1;
    if (index >= 0 && index !== next.active) setActive(next, index, false);
  });
  dialog.addEventListener("click", (event) => {
    // A click on the backdrop lands on the dialog itself: the panel fills everything else.
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector("[data-ni-search-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => onClose(next));
  // A page restored from the back-forward cache must not come back with the dialog still open.
  addEventListener("pagehide", () => {
    if (dialog.open) dialog.close();
  });

  view = next;
  return next;
}

function show(v: View, state: State) {
  v.results.hidden = state !== "results";
  v.categories.hidden = state === "results";
  v.none.hidden = state !== "none";
  v.empty.hidden = state !== "empty";
  v.error.hidden = state !== "error";
  v.input.setAttribute("aria-expanded", String(state === "results"));
  if (state !== "results") {
    v.input.removeAttribute("aria-activedescendant");
    v.active = -1;
  }
}

function announce(v: View, text: string) {
  clearTimeout(v.timer);
  v.timer = setTimeout(() => {
    v.live.textContent = text;
  }, ANNOUNCE_DELAY_MS);
}

function setCount(v: View, text: string) {
  v.count.textContent = text;
  announce(v, text);
}

function setActive(v: View, index: number, scroll = true) {
  const options = v.results.children;
  options[v.active]?.setAttribute("aria-selected", "false");
  const option = options[index];
  if (!option) {
    v.active = -1;
    v.input.removeAttribute("aria-activedescendant");
    return;
  }
  v.active = index;
  option.setAttribute("aria-selected", "true");
  v.input.setAttribute("aria-activedescendant", option.id);
  if (scroll) option.scrollIntoView({ block: "nearest" });
}

function optionOf(v: View, hit: SearchHit, index: number): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "ni-search__result";
  link.id = `${OPTION_ID}${index}`;
  link.href = hit.record.href;
  link.setAttribute("role", "option");
  link.setAttribute("aria-selected", "false");
  link.dataset.cat = hit.record.category;

  const category = v.info.get(hit.record.category);
  const chip = el("span", "ni-icon-tint");
  const icon = category?.icon?.cloneNode(true);
  if (icon) chip.append(icon);

  const name = el("span", "ni-search__result-name");
  appendHighlighted(name, hit.record.name, hit.name);
  const head = el("span", "ni-search__result-head");
  head.append(name);
  if (category?.name) head.append(el("span", "ni-search__result-category", category.name));

  const summary = el("span", "ni-search__result-summary");
  appendHighlighted(summary, hit.record.summary, hit.summary);

  const body = el("span", "ni-search__result-body");
  body.append(head, summary);
  if (hit.hint) body.append(el("span", "ni-search__result-hint", hintText(hit.hint)));

  link.append(chip, body);
  return link;
}

/** Shows what the input holds: the categories, or the results for it, or an honest message. */
function draw(v: View, found: Engine | undefined) {
  const query = v.input.value.trim();
  if (!found) {
    show(v, "error");
    setCount(v, "");
    announce(v, "Search could not load.");
    return;
  }
  if (found.size === 0) {
    show(v, "empty");
    setCount(v, "");
    announce(v, "No tools yet.");
    return;
  }
  if (query === "") {
    show(v, "idle");
    setCount(v, "");
    announce(v, "");
    return;
  }
  const { hits, total } = found.search(query, { limit: RESULT_LIMIT });
  if (hits.length === 0) {
    v.query.textContent = query;
    show(v, "none");
    setCount(v, "No tools found");
    return;
  }
  v.results.replaceChildren(...hits.map((hit, index) => optionOf(v, hit, index)));
  show(v, "results");
  setActive(v, 0, false);
  const noun = total === 1 ? "tool" : "tools";
  setCount(
    v,
    total > hits.length ? `Showing ${hits.length} of ${total} tools` : `${total} ${noun} found`,
  );
}

function refresh(v: View) {
  const token = ++v.token;
  if (engine) {
    draw(v, engine);
    return;
  }
  void loadEngine().then((found) => {
    if (token === v.token) draw(v, found);
  });
}

function onKey(v: View, event: KeyboardEvent) {
  const count = v.results.children.length;
  const listing = !v.results.hidden && count > 0;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!listing) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    setActive(v, (v.active + step + count) % count);
  } else if (event.key === "Enter") {
    const option = listing ? v.results.children[v.active] : undefined;
    if (!option) return;
    event.preventDefault();
    // A click, not a navigation: Ctrl+Enter and Cmd+Enter then open a new tab, as they would on a link.
    option.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      }),
    );
  }
}

/** The first trigger that is on screen, for when the element that had focus is gone. */
function visibleTrigger(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(SEL.trigger)].find(
    (item) => item.getClientRects().length > 0,
  );
}

/** Empties the field and the results, and cancels a search still running. */
function reset(v: View) {
  v.token++;
  clearTimeout(v.timer);
  v.input.value = "";
  v.results.replaceChildren();
  show(v, "idle");
  v.count.textContent = "";
  v.live.textContent = "";
}

function onClose(v: View) {
  // The close event is queued as a task, and a browser may handle input first: Ctrl+K right after
  // Esc or the close button reopens the dialog before the event arrives. The reopened dialog has
  // focus in its field and is already reset (open), so the late event must not move focus away.
  if (v.dialog.open) return;
  reset(v);
  // Back to what had focus, which is the trigger when the visitor clicked it. When nothing had
  // focus (a shortcut on a bare page) or it is gone, to the trigger, so focus is never lost.
  const target =
    v.opener?.isConnected && v.opener.getClientRects().length > 0 ? v.opener : visibleTrigger();
  v.opener = null;
  target?.focus();
}

/** Opens the search dialog. `opener` is what had focus, and gets it back when the dialog closes. */
export function open(opener?: Element | null): void {
  const v = wire();
  if (!v) return;
  if (v.dialog.open) {
    v.input.focus();
    return;
  }
  v.opener = opener instanceof HTMLElement && opener !== document.body ? opener : null;
  // Normally the close event has reset it already; not when the dialog is reopened before it came.
  reset(v);
  v.dialog.showModal();
  v.input.focus();
  refresh(v);
}

// ---------------------------------------------------------------------------------------------
// The /tools/ filter

function initFilter() {
  const root = document.querySelector<HTMLElement>("[data-ni-filter]");
  if (!root || root.dataset.ready !== undefined) return;
  const input = root.querySelector<HTMLInputElement>("[data-ni-filter-input]");
  const list = document.querySelector<HTMLElement>("[data-ni-filter-list]");
  const status = root.querySelector<HTMLElement>("[data-ni-filter-status]");
  const none = root.querySelector<HTMLElement>("[data-ni-filter-none]");
  const query = root.querySelector<HTMLElement>("[data-ni-filter-query]");
  const clear = root.querySelector<HTMLElement>("[data-ni-filter-clear]");
  if (!input || !list || !status || !none || !query || !clear) return;
  root.dataset.ready = "";

  // Each tool's row, by the address of its page: the same address the index holds.
  const rows = new Map<string, HTMLElement>();
  for (const link of list.querySelectorAll<HTMLAnchorElement>("li > a[href]")) {
    const row = link.parentElement;
    if (row) rows.set(link.getAttribute("href") ?? "", row);
  }
  const groups = [...list.querySelectorAll<HTMLElement>("[data-ni-filter-group]")];

  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The count is a live region, so it is written once typing pauses, not after every letter.
  const say = (text: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      status.textContent = text;
    }, ANNOUNCE_DELAY_MS);
  };
  const showAll = () => {
    for (const row of rows.values()) row.hidden = false;
    for (const group of groups) group.hidden = false;
    none.hidden = true;
  };

  const apply = (found: Engine | undefined) => {
    const text = input.value.trim();
    if (!found) {
      showAll();
      say("Filtering is unavailable. Every tool is listed below.");
      return;
    }
    if (text === "") {
      showAll();
      say("");
      return;
    }
    const matched = new Set(
      found
        .search(text, { limit: Number.POSITIVE_INFINITY, highlight: false })
        .hits.map((hit) => hit.record.href),
    );
    let visible = 0;
    for (const [href, row] of rows) {
      const shown = matched.has(href);
      if (row.hidden === shown) row.hidden = !shown;
      if (shown) visible++;
    }
    for (const group of groups) {
      group.hidden = group.querySelector("li:not([hidden])") === null;
    }
    query.textContent = text;
    none.hidden = visible > 0;
    say(`${visible} of ${rows.size} tools`);
  };

  const run = () => {
    const mine = ++token;
    const finish = (found: Engine | undefined) => {
      if (mine === token) apply(found);
    };
    if (engine) finish(engine);
    else void loadEngine().then(finish);
  };

  input.addEventListener("input", run);
  clear.addEventListener("click", () => {
    input.value = "";
    run();
    input.focus();
  });
  // The browser may have restored the text of a previous visit: make the list agree with it.
  if (input.value.trim() !== "") run();
}

// ---------------------------------------------------------------------------------------------

/**
 * Called by the loader on every intent, and safe to call again: wires the /tools/ filter when the
 * page has one, and starts fetching the index so it is ready before the first keystroke.
 */
export function start(): void {
  initFilter();
  void loadEngine();
}
