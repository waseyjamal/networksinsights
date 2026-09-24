// When a visitor means to search (ADR 0046). Pure functions over the few event fields they read,
// so the rules are tested in Node and the loader stays a few lines of glue.

/** The parts of a keyboard event the shortcut rules read. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  target: unknown;
}

/** The parts of a mouse event the click rules read. */
export interface ClickLike {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the target is somewhere the visitor types, where "/" is a character. */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const { tagName, isContentEditable } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  return (
    (typeof tagName === "string" && TYPING_TAGS.has(tagName.toUpperCase())) ||
    isContentEditable === true
  );
}

/**
 * Ctrl+K and Cmd+K open search from anywhere, as in every command bar. "/" opens it too, but not
 * while the visitor is typing in a field, and not with a modifier: those are other shortcuts.
 * Shift is allowed for "/", because some keyboard layouts type it with Shift.
 */
export function isSearchShortcut(event: KeyLike): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const key = event.key;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "k" || key === "K"))
    return true;
  if (key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return !isTypingTarget(event.target);
  }
  return false;
}

/** A plain primary-button click. Ctrl-click, middle-click and the rest keep their meaning. */
export function isPlainClick(event: ClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
