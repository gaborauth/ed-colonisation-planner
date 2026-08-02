// Tracks which app version this browser last had loaded — same localStorage-backed "stateless (no
// backend), not state-free" spirit as consent.ts/liveDemoHint.ts. `null` means "never recorded any
// version," distinct from an old recorded version string — hooks/useWhatsNew.ts only shows the
// "what's new" dialog in the latter case, so a genuinely first-ever visitor just gets a silently
// recorded baseline instead of the entire release history.

const STORAGE_KEY = "edcp:changelog-last-seen-version";

export function getLastSeenChangelogVersion(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLastSeenChangelogVersion(version: string): void {
  localStorage.setItem(STORAGE_KEY, version);
}
