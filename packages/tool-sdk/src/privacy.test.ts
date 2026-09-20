import { describe, expect, it } from "vitest";
import { privacyStatement, privacyStatements } from "./privacy";

describe("privacyStatement", () => {
  it("says nothing leaves the device for the client and worker runtimes", () => {
    for (const runtime of ["client", "worker"] as const) {
      expect(privacyStatement(runtime)).toEqual({
        text: privacyStatements.onDevice,
        onDevice: true,
      });
    }
  });

  it("says plainly that the input is sent to us for the server runtime", () => {
    const statement = privacyStatement("server");
    expect(statement.onDevice).toBe(false);
    expect(statement.text).toBe(privacyStatements.server);
    expect(statement.text).toContain("sent to us");
    expect(statement.text).not.toContain("never leave");
  });

  it("has one statement per case and no third", () => {
    expect(new Set(Object.values(privacyStatements)).size).toBe(2);
  });
});
