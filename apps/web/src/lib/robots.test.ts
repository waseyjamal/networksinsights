import { describe, expect, it } from "vitest";
import { robotsContent } from "./robots";

describe("robotsContent", () => {
  it("is noindex, nofollow for every page before launch", () => {
    expect(robotsContent({ launched: false, pageNoindex: false })).toBe("noindex, nofollow");
    expect(robotsContent({ launched: false, pageNoindex: true })).toBe("noindex, nofollow");
  });

  it("after launch, only pages that opt out are noindex", () => {
    expect(robotsContent({ launched: true, pageNoindex: false })).toBeUndefined();
    expect(robotsContent({ launched: true, pageNoindex: true })).toBe("noindex");
  });
});
