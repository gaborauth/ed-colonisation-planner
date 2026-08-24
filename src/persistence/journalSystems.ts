// Persists parsed journal systems (src/journal/parser.ts's JournalSystem) to localStorage, so a
// system stays available in JournalImportPanel's dropdown across page reloads without re-uploading
// the Journal file. Mirrors plans.ts's read/write-store shape.

import { migrateRingBodyIds } from "../journal/parser";
import type { JournalSystem } from "../journal/parser";

const STORAGE_KEY = "edcp:journalSystems";
const LAST_USED_KEY = "edcp:journalSystems:lastUsed";

type SystemStore = Record<number, JournalSystem>; // keyed by systemAddress

/** `migrateRingBodyIds` (see its own doc comment) converts any pre-1.7.0 ring/belt bodyIds this
 * system still has to the current Raven Colonial-matching scheme — a no-op for a system that has
 * none. Also fixes up `firstStationBodyId`, the only other place a bodyId is persisted standalone
 * outside a `JournalBody` itself. Returns `changed: false` when nothing needed migrating, so
 * `readStore` can skip writing storage back for the (overwhelmingly common) already-current case. */
function migrateSystem(system: JournalSystem): { system: JournalSystem; changed: boolean } {
  const { bodies, idRemap } = migrateRingBodyIds(system.bodies);
  if (idRemap.size === 0) return { system, changed: false };
  const firstStationBodyId =
    system.firstStationBodyId !== undefined
      ? (idRemap.get(system.firstStationBodyId) ?? system.firstStationBodyId)
      : system.firstStationBodyId;
  return { system: { ...system, bodies, firstStationBodyId }, changed: true };
}

function readStore(): SystemStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  let store: SystemStore;
  try {
    store = JSON.parse(raw) as SystemStore;
  } catch {
    return {};
  }

  // Self-healing: migrate every stored system once here (the sole read path every other function
  // in this file goes through) and write the result straight back, so a stale ring-bodyId scheme
  // never has to be migrated again on the next read.
  let anyChanged = false;
  for (const [key, system] of Object.entries(store)) {
    const { system: migrated, changed } = migrateSystem(system);
    if (changed) {
      store[Number(key)] = migrated;
      anyChanged = true;
    }
  }
  if (anyChanged) writeStore(store);
  return store;
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
