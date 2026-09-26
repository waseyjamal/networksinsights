// The inline theme script in every page's <head> (Base.astro). It runs before first paint and
// does three things:
//   1. sets data-theme on <html> from localStorage ("light", "dark", or "system" when nothing
//      valid is stored),
//   2. keeps the theme-color metas in step with a manual choice,
//   3. handles the theme toggle (change and storage events).
//
// It is a constant string on purpose. The Content-Security-Policy allows it by its SHA-256 hash,
// which astro.config.mjs computes from this exact text (ADR 0047), and the security-headers
// integration fails the build if a page carries an inline script whose hash is not in the policy.
// Change a single character and the hash changes with it; nothing else needs updating.
export const themeScript = `(() => {
  const root = document.documentElement;
  const KEY = "ni-theme";
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const apply = (value) => {
    const theme = value === "light" || value === "dark" ? value : "system";
    root.dataset.theme = theme;
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    for (const meta of metas) meta._c ??= meta.content;
    const chosen = document.querySelector(
      'meta[name="theme-color"][data-theme-color="' + theme + '"]',
    );
    for (const meta of metas) meta.content = (chosen ?? meta)._c;
  };
  const sync = () => {
    for (const input of document.querySelectorAll("input[data-ni-theme]")) {
      input.checked = input.value === root.dataset.theme;
    }
  };
  apply(read());
  root.dataset.themeJs = "";
  document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute("data-ni-theme")) return;
    try {
      localStorage.setItem(KEY, input.value);
    } catch {}
    apply(input.value);
  });
  addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    apply(event.newValue);
    sync();
  });
})();`;
