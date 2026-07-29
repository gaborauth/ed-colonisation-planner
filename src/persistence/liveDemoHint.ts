// Tracks whether this browser has ever used "Live Demo" — gates the first-visit attention "buzz"
// animation on that button (see App.tsx) so it draws the eye once, for a genuinely new visitor,
// rather than on every reload. Same localStorage-backed "stateless (no backend), not state-free"
// spirit as panelCollapse.ts/objectivePreference.ts.

const STORAGE_KEY = "edcp:hasUsedLiveDemo";

export function getHasUsedLiveDemo(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setHasUsedLiveDemo(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
