import { describe, expect, it } from "vitest";
import { checkFile, containerFor, formatDuration, LIMITS, MESSAGES, outputName } from "./logic";

describe("containers", () => {
  it("keeps the kind of file Mediabunny found", () => {
    expect(containerFor("MP4")).toBe("mp4");
    expect(containerFor("QuickTime File Format")).toBe("mov");
    expect(containerFor("WebM")).toBe("webm");
    expect(containerFor("Matroska")).toBe("mkv");
  });

  it("names the muted copy with the extension of its container", () => {
    expect(outputName("holiday.MOV", "mov")).toBe("holiday-muted.mov");
    expect(outputName("clip.m4v", "mp4")).toBe("clip-muted.mp4");
    expect(outputName("talk.webm", "webm")).toBe("talk-muted.webm");
    expect(outputName(".mkv", "mkv")).toBe("video-muted.mkv");
  });
});

describe("files", () => {
  it("accepts the four kinds by type or extension, up to the limit", () => {
    expect(
      checkFile({ name: "a.mp4", type: "video/mp4", size: LIMITS.maxInputBytes }),
    ).toBeUndefined();
    expect(checkFile({ name: "a.mkv", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a", type: "video/quicktime", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("500 MB"),
    );
    expect(checkFile({ name: "a.avi", type: "video/x-msvideo", size: 1 })).toBe(MESSAGES.notVideo);
  });
});

it("formats lengths", () => {
  expect(formatDuration(2.04)).toBe("0:02");
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(3600)).toBe("1:00:00");
});
