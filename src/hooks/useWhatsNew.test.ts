// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { getLastSeenChangelogVersion, setLastSeenChangelogVersion } from "../persistence/changelogSeen";
import { useWhatsNew } from "./useWhatsNew";

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as Response;
}

const CHANGELOG = `## [${pkg.version}](url) (2026-08-02)

### Bug Fixes

* something new ([abc1234](url))

## [1.0.0](url) (2026-07-27)

### Features

* migrate from Python to React ([abc1234](url))
`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWhatsNew", () => {
  it("first-ever visit: records the current version as the baseline, shows nothing, fetches nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWhatsNew());

    expect(result.current.releases).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getLastSeenChangelogVersion()).toBe(pkg.version);
  });

  it("already on the latest recorded version: shows nothing and fetches nothing", () => {
    setLastSeenChangelogVersion(pkg.version);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWhatsNew());

    expect(result.current.releases).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upgraded from an older recorded version: fetches CHANGELOG.md and shows the releases since then", async () => {
    setLastSeenChangelogVersion("1.0.0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(CHANGELOG)));

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => expect(result.current.releases).not.toBeNull());
    expect(result.current.releases).toEqual([
      { version: pkg.version, date: "2026-08-02", sections: [{ title: "Bug Fixes", items: ["something new"] }] },
    ]);
    expect(getLastSeenChangelogVersion()).toBe(pkg.version);
  });

  it("dismiss clears the shown releases", async () => {
    setLastSeenChangelogVersion("1.0.0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(CHANGELOG)));

    const { result } = renderHook(() => useWhatsNew());
    await waitFor(() => expect(result.current.releases).not.toBeNull());

    result.current.dismiss();
    await waitFor(() => expect(result.current.releases).toBeNull());
  });

  it("a fetch failure leaves the last-seen version unchanged so the next reload retries", async () => {
    setLastSeenChangelogVersion("1.0.0");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current.releases).toBeNull();
    expect(getLastSeenChangelogVersion()).toBe("1.0.0");
  });
});
