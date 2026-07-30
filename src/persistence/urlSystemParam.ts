// Mirrors the active system's name into the page URL's `?system=` query string (for bookmarking)
// and the browser tab title (so a user with several tabs open can tell them apart at a glance) —
// query string, not a path segment, since this app's GitHub Pages deploy has no SPA-fallback
// rewrite for a hard reload/bookmark open (see App.tsx's mount-time read call site). Both are
// written directly at each real system-mutation call site (SystemPortabilityBar's
// applyParsedSystem/switchToSavedSystem/handleDelete, JournalImportPanel's applySystem) rather
// than derived reactively from `formState.starSystem` via a `useEffect` — a `useEffect` keyed off
// form state would run with the PREVIOUS (stale) value during the same commit as a child
// component's own mount-time restore effect (React flushes passive effects bottom-up within one
// commit, before the restore's own `dispatch` has been applied), incorrectly clearing the param
// this module is trying to help apply. Calling this directly at the point where the new value is
// already known sidesteps that entirely.

const SYSTEM_PARAM = "system";

// Matches index.html's static `<title>` exactly — kept as a separate literal here (rather than
// read from `document.title` at import time) so the fallback is deterministic regardless of
// whatever the DOM's title happens to be when this module first loads (e.g. blank under jsdom in
// tests). index.html's own Open Graph/Twitter comment already explains why THAT copy has to stay
// static (crawlers don't execute JS, so this document.title-based one is invisible to them) — this
// is the separate, live-tab-only mirror for an already-open browser tab. Exported so tests can
// assert against the same literal rather than duplicating it (or reading jsdom's own unrelated
// default `document.title`, which never matches this).
export const BASE_TITLE = "EDCPS: Elite Dangerous Colonisation Planner & Solver";

/** Reads the `?system=` query param from the current URL. `URLSearchParams` already
 * percent-decodes it, so real system names with apostrophes/special characters round-trip
 * correctly with no manual `decodeURIComponent`. Returns `null` when absent. */
export function getSystemNameFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(SYSTEM_PARAM);
}

function setSystemNameInUrl(starSystem: string | undefined): void {
  const url = new URL(window.location.href);
  if (starSystem) {
    url.searchParams.set(SYSTEM_PARAM, starSystem);
  } else {
    url.searchParams.delete(SYSTEM_PARAM);
  }
  window.history.replaceState(null, "", url);
}

function setDocumentTitleForSystem(starSystem: string | undefined): void {
  document.title = starSystem ? `${starSystem} – ${BASE_TITLE}` : BASE_TITLE;
}

/** Updates both the URL's `?system=` query param and the browser tab title to reflect the active
 * system, via `history.replaceState` (not `pushState` — switching systems shouldn't spam the
 * back-button history). Pass `undefined`/`""` to clear both entirely (e.g. after "Delete" resets
 * to a blank system). */
export function syncActiveSystemToBrowser(starSystem: string | undefined): void {
  setSystemNameInUrl(starSystem);
  setDocumentTitleForSystem(starSystem);
}
