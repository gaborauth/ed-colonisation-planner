// Persists parsed journal systems (src/journal/parser.ts's JournalSystem) to localStorage, so a
// system stays available in JournalImportPanel's dropdown across page reloads without re-uploading
// the Journal file. Mirrors plans.ts's read/write-store shape.

import type { JournalSystem } from "../journal/parser";

const STORAGE_KEY = "edcp:journalSystems";
const LAST_USED_KEY = "edcp:journalSystems:lastUsed";

type SystemStore = Record<number, JournalSystem>; // keyed by systemAddress

function readStore(): SystemStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SystemStore;
  } catch {
    return {};
  }
}

function writeStore(store: SystemStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listSavedSystems(): JournalSystem[] {
  return Object.values(readStore()).sort((a, b) => a.starSystem.localeCompare(b.starSystem));
}

export function saveSystem(system: JournalSystem): void {
  const store = readStore();
  store[system.systemAddress] = system;
  writeStore(store);
}

export function deleteSystem(systemAddress: number): void {
  const store = readStore();
  delete store[systemAddress];
  writeStore(store);
  // Otherwise a deleted system's address would linger in LAST_USED_KEY, pointing at a system that
  // no longer exists in the store.
  if (getLastUsedSystemAddress() === systemAddress) {
    localStorage.removeItem(LAST_USED_KEY);
  }
}

/** Which system was last applied to the System facilities panel — lets `JournalImportPanel` restore
 * that system (and, if it has a saved primary station, auto-apply it) on the next page load instead
 * of always defaulting to whichever saved system sorts first alphabetically. */
export function getLastUsedSystemAddress(): number | null {
  const raw = localStorage.getItem(LAST_USED_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setLastUsedSystemAddress(systemAddress: number): void {
  localStorage.setItem(LAST_USED_KEY, String(systemAddress));
}
