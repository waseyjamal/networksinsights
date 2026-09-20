// Fixture: a Node-only global, which would not exist in the browser.
export function mode(): string | undefined {
  return process.env.NODE_ENV;
}
