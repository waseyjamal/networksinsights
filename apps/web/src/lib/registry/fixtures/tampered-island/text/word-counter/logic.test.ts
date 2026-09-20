import { expect, it } from "vitest";
import { count } from "./logic";

// Fixture: the contract requires this file. The web project excludes fixtures from its run.
it("counts words", () => {
  expect(count("two words")).toBe(2);
});
