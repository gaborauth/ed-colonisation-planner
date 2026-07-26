// Remembers a foldable panel's collapsed/expanded state across sessions — same localStorage-backed
// "stateless (no backend), not state-free" spirit as consent.ts/objectivePreference.ts. Keyed by an
// arbitrary panel id so more panels can opt in later without a new store each time (2026-07-26 user
// request, starting with AboutHelpPanel).

const STORAGE_PREFIX = "edcp:panel-collapsed:";

export function getStoredPanelCollapsed(panelId: string): boolean | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + panelId);
  if (raw === null) return null;
  return raw === "true";
}

export function setStoredPanelCollapsed(panelId: string, collapsed: boolean): void {
  localStorage.setItem(STORAGE_PREFIX + panelId, String(collapsed));
}
