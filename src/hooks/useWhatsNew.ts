import { useEffect, useState } from "react";
import pkg from "../../package.json";
import { parseChangelog, releasesSince, type ChangelogRelease } from "../domain/changelog";
import { getLastSeenChangelogVersion, setLastSeenChangelogVersion } from "../persistence/changelogSeen";

/** Drives WhatsNewDialog.tsx: this app is a silently self-updating client-only SPA (no install
 * prompt, no "reload for a new version" banner), so a returning visitor has no other way to notice
 * what changed since their last visit. Compares the bundled `pkg.version` (fixed at build time)
 * against the last version recorded in this browser; if newer, fetches the same CHANGELOG.md
 * semantic-release already writes (served by vite.config.ts's changelogPlugin) and shows every
 * release in between. */
export function useWhatsNew() {
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(null);

  useEffect(() => {
    const lastSeen = getLastSeenChangelogVersion();
    if (lastSeen === null) {
      // First-ever visit: nothing to diff against, so there's nothing to show — just record the
      // baseline so the NEXT version bump has something to compare against.
      setLastSeenChangelogVersion(pkg.version);
      return;
    }
    if (lastSeen === pkg.version) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`);
        if (!res.ok) throw new Error(`CHANGELOG.md fetch failed: ${res.status}`);
        const text = await res.text();
        const newReleases = releasesSince(parseChangelog(text), lastSeen);
        if (cancelled) return;
        if (newReleases.length > 0) setReleases(newReleases);
        // Only recorded on a successful fetch/parse — a transient network failure should retry on
        // the next reload rather than silently losing this version bump's changelog forever.
        setLastSeenChangelogVersion(pkg.version);
      } catch (e) {
        console.error("Failed to load changelog", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss(): void {
    setReleases(null);
  }

  return { releases, dismiss };
}
