// Persists parsed journal systems (src/journal/parser.ts's JournalSystem) to localStorage, so a
// system stays available in JournalImportPanel's dropdown across page reloads without re-uploading
// the Journal file. Mirrors plans.ts's read/write-store shape.

import type { JournalSystem } from "../journal/parser";

const STORAGE_KEY = "edcp:journalSystems";

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
}
