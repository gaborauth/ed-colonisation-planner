import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderChangelogPage } from "./changelogHtml";

const SAMPLE = `## [1.4.6](url) (2026-08-01)

### Bug Fixes

* proxy status check ([c10dfa4](url))
* handle a <script> tag & an ampersand safely ([abc1234](url))

## 1.0.0 (2026-07-27)

### Features

* migrate from Python to React ([3d253c9](url))
`;

describe("renderChangelogPage", () => {
  it("renders one section per release with its version/date and Features/Bug Fixes", () => {
    const html = renderChangelogPage(SAMPLE);
    expect(html).toContain('<section id="v1.4.6">');
    expect(html).toContain("v1.4.6");
    expect(html).toContain("2026-08-01");
    expect(html).toContain("<li>proxy status check</li>");
    expect(html).toContain('<section id="v1.0.0">');
    expect(html).toContain("<li>migrate from Python to React</li>");
  });

  it("HTML-escapes bullet item text instead of injecting it verbatim", () => {
    const html = renderChangelogPage(SAMPLE);
    expect(html).toContain("handle a &lt;script&gt; tag &amp; an ampersand safely");
    expect(html).not.toContain("<script> tag");
  });

  it("renders the real committed CHANGELOG.md without throwing", () => {
    const real = readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf-8");
    const html = renderChangelogPage(real);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<section id="v1.4.6">');
  });
});
