// The privacy statement of a tool page, derived from its runtime and never written by hand
// (ADR 0034). A tool author cannot claim "never leaves your device" for a tool that posts the
// input to a server, because nobody types the sentence: the runtime picks it.
//
// This file imports nothing, so the design system can assert against the same strings without
// pulling Zod into a browser bundle.

import type { ToolRuntime } from "./types";

export const privacyStatements = {
  /** client and worker: the work happens on the user's device (ADR 0016). */
  onDevice: "Runs in your browser — files never leave your device",
  /** server: say plainly that the input is sent to us. */
  server: "Runs on our server — your input is sent to us to be processed",
} as const;

export interface PrivacyStatement {
  /** The sentence shown on the tool page. */
  text: string;
  /** True when nothing the user gives the tool leaves their device. */
  onDevice: boolean;
}

/** The one place a tool page's privacy sentence comes from. */
export function privacyStatement(runtime: ToolRuntime): PrivacyStatement {
  return runtime === "server"
    ? { text: privacyStatements.server, onDevice: false }
    : { text: privacyStatements.onDevice, onDevice: true };
}
