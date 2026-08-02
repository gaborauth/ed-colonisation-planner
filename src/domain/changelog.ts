// Parses the release-notes portion of CHANGELOG.md into structured per-version data, so
// hooks/useWhatsNew.ts can show a "what's new since you last had this open" dialog without a
// separate generated JSON artifact — see CLAUDE.md's rationale for fetching CHANGELOG.md itself
// rather than a synced copy. The heading/section shape parsed here is
// @semantic-release/changelog's own conventionalcommits-preset output (.releaserc.json), not a
// format this app controls — a future preset change could require updating these regexes.

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

// Matches both "## [1.4.6](url) (2026-08-01)" (has a prior tag to compare against) and the very
// first release's "## 1.0.0 (2026-07-27)" (no link, nothing to compare against).
const RELEASE_HEADING = /^## (?:\[(\d+\.\d+\.\d+)]\([^)]*\)|(\d+\.\d+\.\d+)) \((\d{4}-\d{2}-\d{2})\)\s*$/;
const SECTION_HEADING = /^### (.+)$/;
const BULLET_ITEM = /^\* (.+)$/;

// Strips the trailing commit-hash link (e.g. "([c10dfa4](url))") and "closes [#96](url)" issue
// refs semantic-release appends to every bullet — noise for a player-facing changelog popup.
function stripMarkdownNoise(text: string): string {
  return text
    .replace(/\s*\(\[[0-9a-f]{7,40}]\([^)]*\)\)/gi, "")
    .replace(/,?\s*closes\s*\[[^\]]+]\([^)]*\)/gi, "")
    .trim();
}

/** Stops at the first non-release "## " heading (e.g. "## Project history") — that section is
 * prose, not a per-version entry, and was never meant to be shown in a changelog popup. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    const releaseMatch = RELEASE_HEADING.exec(line);
    if (releaseMatch) {
      current = { version: releaseMatch[1] ?? releaseMatch[2], date: releaseMatch[3], sections: [] };
      releases.push(current);
      currentSection = null;
      continue;
    }
    if (line.startsWith("## ")) {
      current = null;
      currentSection = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1].trim(), items: [] };
      current.sections.push(currentSection);
      continue;
    }

    const bulletMatch = BULLET_ITEM.exec(line);
    if (bulletMatch && currentSection) {
      currentSection.items.push(stripMarkdownNoise(bulletMatch[1]));
    }
  }

  return releases;
}

/** `releases` is newest-first, matching CHANGELOG.md's own order. Returns every release strictly
 * newer than `lastSeenVersion`. If `lastSeenVersion` isn't found at all (e.g. a version old enough
 * to have scrolled out, however unlikely), falls back to just the latest release rather than
 * dumping the whole history. */
export function releasesSince(releases: ChangelogRelease[], lastSeenVersion: string): ChangelogRelease[] {
  const seenIndex = releases.findIndex((r) => r.version === lastSeenVersion);
  if (seenIndex === -1) return releases.slice(0, 1);
  return releases.slice(0, seenIndex);
}
