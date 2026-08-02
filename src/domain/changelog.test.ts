import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseChangelog, releasesSince } from "./changelog";

const SAMPLE = `## [1.4.6](https://github.com/gaborauth/ed-colonisation-planner/compare/v1.4.5...v1.4.6) (2026-08-01)

### Bug Fixes

* proxy status check ([c10dfa4](https://github.com/gaborauth/ed-colonisation-planner/commit/c10dfa48c7a0a98c709506ac508ead75b6a1304b))

## [1.4.3](https://github.com/gaborauth/ed-colonisation-planner/compare/v1.4.2...v1.4.3) (2026-07-30)

### Bug Fixes

* put the active system name in the url and title ([bcceb09](https://github.com/gaborauth/ed-colonisation-planner/commit/bcceb09c35f0450507bbc457f5fe5f987af2cedd))
* rewrite objective panel preset and expression ([735ec60](https://github.com/gaborauth/ed-colonisation-planner/commit/735ec60b2822ca1721e11ac6d2050d928c64464c)), closes [#96](https://github.com/gaborauth/ed-colonisation-planner/issues/96)

## 1.0.0 (2026-07-27)

### Features

* migrate from Python to React ([3d253c9](https://github.com/gaborauth/ed-colonisation-planner/commit/3d253c9069e3cde1fc5d348d562a909ad1ec414c))

## Project history

**2026-07 — rewritten as this app.** Some prose that must never be parsed as a release.
`;

describe("parseChangelog", () => {
  it("extracts version/date/sections for a linked release heading", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[0]).toEqual({
      version: "1.4.6",
      date: "2026-08-01",
      sections: [{ title: "Bug Fixes", items: ["proxy status check"] }],
    });
  });

  it("extracts version/date for the first, link-less release heading", () => {
    const releases = parseChangelog(SAMPLE);
    const first = releases.find((r) => r.version === "1.0.0");
    expect(first?.date).toBe("2026-07-27");
    expect(first?.sections).toEqual([{ title: "Features", items: ["migrate from Python to React"] }]);
  });

  it("strips both the commit-hash link and a trailing 'closes' issue reference", () => {
    const releases = parseChangelog(SAMPLE);
    const bugfixes = releases.find((r) => r.version === "1.4.3")?.sections[0].items;
    expect(bugfixes).toEqual([
      "put the active system name in the url and title",
      "rewrite objective panel preset and expression",
    ]);
  });

  it("stops parsing at the first non-release heading (e.g. 'Project history')", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((r) => r.version)).toEqual(["1.4.6", "1.4.3", "1.0.0"]);
  });

  it("parses the real committed CHANGELOG.md without throwing and without any zero-version entries", () => {
    const real = readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf-8");
    const releases = parseChangelog(real);
    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("releasesSince", () => {
  const releases = parseChangelog(SAMPLE);

  it("returns every release newer than the last-seen version", () => {
    expect(releasesSince(releases, "1.4.3").map((r) => r.version)).toEqual(["1.4.6"]);
  });

  it("returns an empty array when the last-seen version is already the newest", () => {
    expect(releasesSince(releases, "1.4.6")).toEqual([]);
  });

  it("falls back to just the latest release when the last-seen version isn't found at all", () => {
    expect(releasesSince(releases, "0.0.1").map((r) => r.version)).toEqual(["1.4.6"]);
  });
});
