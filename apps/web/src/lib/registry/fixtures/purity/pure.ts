import { privacyStatement } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { SEPARATOR } from "./shared";

// Fixture: a logic.ts that follows the purity rule. Allowlisted imports, a relative import from
// its own folder, and only web APIs that a browser, a Web Worker and a server all have.

export const schema = z.object({ text: z.string() });

const encoder = new TextEncoder();

export function fingerprint(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(text));
}

export function describe(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const size = new Intl.NumberFormat("en").format(words.length);
  return [size, privacyStatement("client").text, new URL("https://example.com").host].join(
    SEPARATOR,
  );
}

export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return btoa(String.fromCharCode(...bytes));
}
