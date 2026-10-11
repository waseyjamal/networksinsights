// The app shell script (ADR 0072): one deferred module on every page, at most 1 KB gzip. It does
// two small jobs that only JavaScript can do:
//
//   1. Navigation feedback. A tap on an internal link shows the thin bar at the top of the page at
//      once, so a visitor, and the installed app, which has no browser loading bar, can see that
//      the next page is on its way. The bar clears on `pageshow`, which also fires when the back
//      button restores a page from the back/forward cache.
//   2. The "Install app" control. It stays hidden until this script decides the browser can
//      install the site, and how: the browser's own prompt where it has one (Chromium), or a
//      dialog with the steps for the browsers that install from a menu. It imports nothing, so
//      the whole shell stays in one small file.
//
// It stores nothing and sends nothing.

/** How this browser can install the site, if at all. */
export type InstallPlatform =
  | "prompt"
  | "ios"
  | "mac-safari"
  | "firefox-android"
  | "in-app"
  | "none";

/**
 * The part of `window` the platform decision reads, so a test can hand in any browser. The
 * features it tests for are `onbeforeinstallprompt` (Chromium's install prompt), `safari` (desktop
 * Safari's own object) and `mozInnerScreenX` (Firefox).
 */
export interface InstallWindow {
  matchMedia(query: string): { matches: boolean };
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean };
  onbeforeinstallprompt?: unknown;
  safari?: unknown;
  mozInnerScreenX?: unknown;
}

/**
 * The apps whose built-in browser cannot install a site. The user agent is read only for these
 * and for iOS, which no feature test can tell apart.
 */
const IN_APP = /FBA[NV]|Instagram|WhatsApp|Line\/|Snapchat|musical_ly|TikTok|LinkedInApp|Pinterest/;
const IOS = /iP(?:hone|ad|od)/;

export function installPlatform(win: InstallWindow): InstallPlatform {
  const { userAgent, maxTouchPoints, standalone } = win.navigator;
  const media = (query: string) => win.matchMedia(query).matches;
  if (standalone || media("(display-mode: standalone)")) return "none";
  if (IN_APP.test(userAgent)) return "in-app";
  // iPadOS asks for the desktop site and says "Macintosh"; only its touch screen gives it away.
  if (IOS.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if ("onbeforeinstallprompt" in win) return "prompt";
  if ("safari" in win) return "mac-safari";
  if ("mozInnerScreenX" in win && media("(pointer: coarse)")) return "firefox-android";
  // Firefox on a desktop, and any browser we know nothing about, cannot install the site.
  return "none";
}

/** The part of a click the navigation check reads: a MouseEvent has all of it. */
export interface LinkClick {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The part of a link the navigation check reads: an <a> element has all of it. */
export interface ClickedLink {
  href: string;
  target: string;
  hasAttribute(name: "download"): boolean;
}

/**
 * True when a click on a link will load another page of this site in this tab, so the bar should
 * show. A link to a part of the same page, a new tab, a download or another site loads nothing here.
 */
export function startsNavigation(
  click: LinkClick,
  link: ClickedLink | null | undefined,
  here: string,
): boolean {
  if (!link || click.button || click.defaultPrevented) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return false;
  const from = new URL(here);
  const to = new URL(link.href, from);
  return to.origin === from.origin && to.pathname + to.search !== from.pathname + from.search;
}

interface PromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: string }>;
}

const LABEL = "Install app";

export function startAppShell(win: Window): void {
  const doc = win.document;
  const bar = doc.querySelector<HTMLElement>("[data-ni-nav]");

  // 1. Navigation feedback.
  doc.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    if (bar && startsNavigation(event, link, win.location.href)) bar.dataset.state = "loading";
  });
  win.addEventListener("pageshow", () => bar?.removeAttribute("data-state"));

  // 2. Install.
  const buttons = [...doc.querySelectorAll<HTMLButtonElement>("[data-ni-install]")];
  const dialog = doc.querySelector<HTMLDialogElement>("[data-ni-install-dialog]");
  const status = doc.querySelector<HTMLElement>("[data-ni-install-status]");
  const platform = installPlatform(win as unknown as InstallWindow);
  let prompt: PromptEvent | null = null;

  // Every state but the plain label is busy: "Installing…" and "Installed" cannot be pressed,
  // and only they are announced.
  const set = (label: string, show = true) => {
    const busy = label !== LABEL;
    for (const button of buttons) {
      button.textContent = label;
      button.hidden = !show;
      button.disabled = busy;
    }
    if (status) status.textContent = busy ? label : "";
  };

  if (platform !== "none" && platform !== "prompt") {
    // components.css shows the steps whose name matches the dialog's platform, and only those.
    if (dialog) dialog.dataset.platform = platform;
    set(LABEL);
  }
  // Chromium offers the prompt only when the site can be installed, so the control waits for it.
  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as PromptEvent;
    if (platform === "prompt") set(LABEL);
  });
  win.addEventListener("appinstalled", () => set("Installed"));

  // The dialog's one button is Close.
  dialog?.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button")) dialog.close();
  });
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (!prompt) return dialog?.showModal();
      set("Installing…");
      prompt.prompt();
      // Dismissed: the same prompt cannot be shown twice, so the control waits for a new one.
      prompt.userChoice.then(({ outcome }) => outcome === "accepted" || set(LABEL, false));
      prompt = null;
    });
  }
}
