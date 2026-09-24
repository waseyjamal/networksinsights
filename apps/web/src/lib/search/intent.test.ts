import { describe, expect, it } from "vitest";
import { isPlainClick, isSearchShortcut, isTypingTarget, type KeyLike } from "./intent";

const key = (overrides: Partial<KeyLike>): KeyLike => ({
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  defaultPrevented: false,
  target: { tagName: "BODY", isContentEditable: false },
  ...overrides,
});

describe("isSearchShortcut", () => {
  it("accepts Ctrl+K and Cmd+K, in either case", () => {
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "K", ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "k", metaKey: true }))).toBe(true);
  });

  it("accepts Ctrl+K even while typing in a field", () => {
    const target = { tagName: "INPUT", isContentEditable: false };
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true, target }))).toBe(true);
  });

  it("accepts / on the page, with or without Shift", () => {
    expect(isSearchShortcut(key({ key: "/" }))).toBe(true);
  });

  it("ignores / while typing in a field, a text area, a select or editable text", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "textarea" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      expect(isSearchShortcut(key({ key: "/", target })), JSON.stringify(target)).toBe(false);
    }
  });

  it("ignores other keys, bare k, and / with a modifier", () => {
    expect(isSearchShortcut(key({ key: "k" }))).toBe(false);
    expect(isSearchShortcut(key({ key: "j", ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "/", ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "/", metaKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("ignores a key that something else handled or that is part of composing text", () => {
    expect(isSearchShortcut(key({ key: "/", defaultPrevented: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "/", isComposing: true }))).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("is false for things that are not elements", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("input")).toBe(false);
  });
});

describe("isPlainClick", () => {
  const click = {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };

  it("accepts a plain primary click", () => {
    expect(isPlainClick(click)).toBe(true);
  });

  it("leaves middle-clicks and modified clicks to the browser", () => {
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});
