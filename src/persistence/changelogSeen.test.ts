// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getLastSeenChangelogVersion, setLastSeenChangelogVersion } from "./changelogSeen";

beforeEach(() => {
  localStorage.clear();
});

describe("changelogSeen persistence", () => {
  it("returns null when no version has ever been recorded", () => {
    expect(getLastSeenChangelogVersion()).toBeNull();
  });

  it("round-trips a recorded version", () => {
    setLastSeenChangelogVersion("1.4.6");
    expect(getLastSeenChangelogVersion()).toBe("1.4.6");
  });

  it("overwrites a previously recorded version", () => {
    setLastSeenChangelogVersion("1.4.5");
    setLastSeenChangelogVersion("1.4.6");
    expect(getLastSeenChangelogVersion()).toBe("1.4.6");
  });
});
