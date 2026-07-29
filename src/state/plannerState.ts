import { ALL_SCORES, type EconomyType, type Score } from "../data/buildings";
import {
  normalizeBlockedSlots,
  normalizeFacilitySlots,
  syncPrimaryIntoBodies,
  type PresentFacilitySlot,
} from "../domain/presentFacilities";
import { systemResourceLevel, type ResourceLevel } from "../domain/economyOverrides";
import type { JournalBody } from "../journal/parser";
import type { Direction, EconomyPreference, SlotAvailability, SolverResult } from "../solver/solve";

// Exported (not just inlined into INITIAL_FORM_STATE below) so ObjectivePanel.tsx's "Default
// preset" entry can reference the exact same string — one source of truth, so the dropdown's
// "is this preset currently active" check (`expression === formState.customExpression`) can never
// silently drift out of sync with what a fresh session actually starts with. `+ p` (economy_
// preference) added alongside `y` (economy_synergy) — same precedent as when `y` itself was added:
// Want/Don't want preferences only actually bias the solve when the active objective references
// `p`, same as economy_synergy today (see solve.ts's SolverInput.economyPreferences doc comment).
//
// `e` (security), `n` (standard_of_living), `y`, and `p` are deliberately kept OUTSIDE the
// sqrt(...) wrapping the other stats get, added as plain linear terms instead — unlike
// initial/max population increase, tech, wealth, and development (which no building's stats ever
// push negative), several real buildings carry a negative `sec` or `sol` contribution (e.g.
// Orbis_or_Ocellus's sec: -3, Industrial_Hub's sol: -4 in data/buildings.ts), and `y`/`p` can go
// negative by construction (a strong-link decrease condition, or a "Don't want" economy
// preference). `objective.ts`'s concave-function linearizer doesn't error on a negative-reaching
// argument — `pickBreakpoints` just clamps its lowest sample to x=1 (its `domainPositive` handling)
// and silently extrapolates that breakpoint's tangent line forever below it, so `sqrt(e)` would
// quietly become a fixed-slope LINEAR penalty on security instead of a diminishing-returns curve
// the instant a solved layout pushes security negative — a real, reachable case, not a hypothetical
// edge case. Don't re-wrap `e`/`n`/`y`/`p` in sqrt/ln/pow without re-solving this.
export const DEFAULT_OBJECTIVE_EXPRESSION =
  "sqrt(i) + sqrt(m) + e + sqrt(t) + sqrt(w) + n + sqrt(d) + 2 * w + t - abs(w - 2 * t) + y + p";

export interface PlannerFormState {
  slots: SlotAvailability;
  /** Per-body layout from JournalImportPanel's "Apply slots and body layout to System facilities"
   * button. Empty => aggregate mode (today's exact behavior, `slots` above is the only capacity
   * input). Non-empty => per-body placement mode (see `solve.ts`'s `SolverInput.bodies`) — `slots`
   * above still gets kept in sync as the aggregate total for display/fallback purposes. */
  bodies: JournalBody[];
  /** The system's resource level (real in-game `ReserveLevel` — Pristine/Major/Common/Low/Depleted),
   * feeding `economyOverrides.ts`'s Extraction/Industrial/Refinery boost-decrease and `solve.ts`'s
   * `economy_synergy` term. Always has a value (defaults to `"pristine"` — most colonizable systems
   * actually are, per real-game observation; only some inner-bubble systems differ) rather than
   * `null`/"unknown", since a manually-editable best-effort guess is more useful than blocking on
   * data Spansh/Journal don't always provide (a system can have no per-body `reserveLevel` at all —
   * e.g. no ringed body was scanned closely enough, or Spansh's dump simply omits it even for a
   * system with a real scanned belt). `JournalImportPanel`'s `applySystem` seeds this from real
   * per-body detection (`systemResourceLevel(bodies)`) when present, falling back to `"pristine"`
   * otherwise; freely editable afterward via the System facilities panel's dropdown. Only meaningful
   * once `bodies` is non-empty, same per-body-mode-only scope as `economyPreferences` below. */
  systemResourceLevel: ResourceLevel;
  /** Which saved journal system `bodies` came from — set by `JournalImportPanel`'s "Apply" button
   * alongside `bodies`/`slots`/`systemConfigured`. Lets the System facilities panel's own "Save"
   * button write already-built-facility edits back into `persistence/journalSystems.ts`'s store
   * without needing a separate manually-entered system identifier (every system's bodies come from
   * a journal import, never typed in by hand — see CLAUDE.md). Null until a system is applied. */
  systemAddress: number | null;
  starSystem: string;
  /** The full Raven Colonial "Export backup" JSON last imported for this system, kept verbatim — set
   * alongside `bodies`/`systemAddress`/`starSystem` by `JournalImportPanel`'s "Apply" button
   * whenever `bodies` came from a system that's had a Raven Colonial file overlaid onto it (see
   * `journal/parser.ts`'s `JournalSystem.ravenColonialSkeleton`). Undefined for a system that's
   * never had one imported — gates `SolvedSystemPanel`'s "Export Raven Colonial" button, since
   * fields like `id64`/`pos`/`architect`/`v`/`rev` have no other source in this app. */
  ravenColonialSkeleton: Record<string, unknown> | undefined;
  /** Whether the System facilities panel's fields have been unlocked for editing — either by applying a
   * journal body layout, or by explicitly clicking "Enter slots manually". Starts `false` (panel
   * greyed out and disabled) so a fresh session doesn't look like it's mid-configuration; a
   * `reset` naturally re-locks it since it's part of `INITIAL_FORM_STATE`. */
  systemConfigured: boolean;
  /** The primary/claim station's building type — always required, never solver-chosen (every
   * colonised system needs exactly one, built first, in its own dedicated slot). Empty string
   * means "not yet picked" (blocks solving, same as `solve.ts`'s own validation). */
  firstStationBuilding: string;
  /** Which imported body the primary station sits on — only meaningful once `bodies` is non-empty;
   * undefined leaves it unassigned (still solves fine, just doesn't show up in the Links panel). */
  firstStationBodyId: number | undefined;
  /** Purely cosmetic design variant / user nickname for the primary station — see
   * `journal/parser.ts`'s `JournalSystem.firstStationVariant`/`firstStationCustomName`. Never
   * affects stats/costs/solver behavior, only display. */
  firstStationVariant: string | undefined;
  firstStationCustomName: string | undefined;
  allowCriminal: boolean;
  alreadyPresent: Record<string, number>;
  atLeast: Record<string, number>;
  atMost: Record<string, number>;
  objectiveMode: "simple" | "custom";
  simpleScore: Score;
  customExpression: string;
  customDirection: Direction;
  scoreMin: Partial<Record<Score, number>>;
  scoreMax: Partial<Record<Score, number>>;
  /** Per-`EconomyType` Must/Want/Don't-want/Forbid steering — ObjectivePanel's "Economy
   * preferences" table. Absent per economy = "Dunno", today's unbiased default. Only meaningful
   * once `bodies` is non-empty (see `solve.ts`'s `SolverInput.economyPreferences` doc comment) —
   * same session/system scope as `scoreMin`/`scoreMax`/`atLeast`/`atMost`, not persisted to
   * localStorage the way `objectiveMode`/`customExpression` are. */
  economyPreferences: Partial<Record<EconomyType, EconomyPreference>>;
}

export const INITIAL_FORM_STATE: PlannerFormState = {
  slots: { space: 0, ground: 0, asteroid: 0 },
  bodies: [],
  systemResourceLevel: "pristine",
  systemAddress: null,
  starSystem: "",
  ravenColonialSkeleton: undefined,
  systemConfigured: false,
  firstStationBuilding: "",
  firstStationBodyId: undefined,
  firstStationVariant: undefined,
  firstStationCustomName: undefined,
  allowCriminal: true,
  alreadyPresent: {},
  atLeast: {},
  atMost: {},
  // Defaults to a custom expression combining ObjectivePanel's two presets ("Balance all stats" +
  // "Maximize wealth and tech, close to 2:1"), plus `y` (economy_synergy — see solve.ts's header
  // comment): a reasonable one-size-fits-most starting point for "propose the best layout," rather
  // than a single arbitrary score. `scoreMin.security: 1` below keeps it a hard constraint, not
  // just an objective term — user-reported reason: NPCs interdict during hauling once system
  // security goes negative, so "positive security" is a real requirement, not just nice-to-have.
  objectiveMode: "custom",
  simpleScore: "development_level",
  customExpression: DEFAULT_OBJECTIVE_EXPRESSION,
  customDirection: "maximize",
  scoreMin: { security: 1 },
  scoreMax: {},
  economyPreferences: {},
};

export type PlannerAction =
  | { type: "patch"; patch: Partial<PlannerFormState> }
  | { type: "setMapEntry"; map: "alreadyPresent" | "atLeast" | "atMost"; name: string; value: number | undefined }
  | { type: "setScoreBound"; bound: "scoreMin" | "scoreMax"; score: Score; value: number | undefined }
  | { type: "setEconomyPreference"; economy: EconomyType; value: EconomyPreference | undefined }
  | {
      type: "setFacilitySlot";
      bodyId: number;
      kind: "space" | "ground";
      index: number;
      slot: PresentFacilitySlot | null;
    }
  | { type: "setSlotBlocked"; bodyId: number; kind: "space" | "ground"; index: number; blocked: boolean }
  | { type: "load"; state: PlannerFormState }
  | { type: "reset" };

function withMapEntry(
  map: Record<string, number>,
  name: string,
  value: number | undefined,
  // "At most 0" is a real, meaningful constraint (build none of this) distinct from "unset" (no
  // cap) — unlike `atLeast`/`alreadyPresent`, where 0 and unset behave identically, so treating
  // them as the same storage state there is a harmless simplification, not for `atMost`.
  deleteOnZero: boolean,
): Record<string, number> {
  const next = { ...map };
  if (value === undefined || (deleteOnZero && value === 0)) {
    delete next[name];
  } else {
    next[name] = value;
  }
  return next;
}

function applyAction(state: PlannerFormState, action: PlannerAction): PlannerFormState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "setMapEntry":
      return {
        ...state,
        [action.map]: withMapEntry(state[action.map], action.name, action.value, action.map !== "atMost"),
      };
    case "setScoreBound": {
      const next = { ...state[action.bound] };
      if (action.value === undefined) {
        delete next[action.score];
      } else {
        next[action.score] = action.value;
      }
      return { ...state, [action.bound]: next };
    }
    case "setEconomyPreference": {
      const next = { ...state.economyPreferences };
      if (action.value === undefined) {
        delete next[action.economy];
      } else {
        next[action.economy] = action.value;
      }
      return { ...state, economyPreferences: next };
    }
    case "setFacilitySlot": {
      const bodies = state.bodies.map((b) => {
        if (b.bodyId !== action.bodyId) return b;
        const count = Math.max(b.slots?.[action.kind] ?? 0, action.index + 1);
        const slots = normalizeFacilitySlots(b.presentFacilities?.[action.kind], count);
        slots[action.index] = action.slot;
        return {
          ...b,
          presentFacilities: {
            space: action.kind === "space" ? slots : (b.presentFacilities?.space ?? []),
            ground: action.kind === "ground" ? slots : (b.presentFacilities?.ground ?? []),
          },
        };
      });
      return { ...state, bodies };
    }
    case "setSlotBlocked": {
      const bodies = state.bodies.map((b) => {
        if (b.bodyId !== action.bodyId) return b;
        const count = Math.max(b.slots?.[action.kind] ?? 0, action.index + 1);
        const blocked = normalizeBlockedSlots(b.blockedSlots?.[action.kind], count);
        blocked[action.index] = action.blocked;
        return {
          ...b,
          blockedSlots: {
            space: action.kind === "space" ? blocked : (b.blockedSlots?.space ?? []),
            ground: action.kind === "ground" ? blocked : (b.blockedSlots?.ground ?? []),
          },
        };
      });
      return { ...state, bodies };
    }
    case "load": {
      // Backward-compat shim, not a full migration system: a `SavedPlan` written before `bodies`
      // existed has `formState.bodies === undefined`. Default it to aggregate mode (`[]`) rather
      // than trusting the stale shape — `plans.ts`'s `readStore()` does no schema validation at
      // all, so this is consistent with that file's existing risk tolerance, not a new precedent.
      const bodies = action.state.bodies ?? [];
      // Same idea for `systemConfigured` (added after `bodies`): a plan saved before it existed
      // has real slot data but no flag — infer "already configured" from that data instead of
      // defaulting to locked, which would surprise anyone loading an otherwise-complete old plan.
      const systemConfigured =
        action.state.systemConfigured ??
        (action.state.slots.space > 0 ||
          action.state.slots.ground > 0 ||
          action.state.slots.asteroid > 0 ||
          bodies.length > 0);
      // Same shim style for `systemAddress`/`starSystem` (added after `bodies`): a plan saved
      // before they existed just can't have its System facilities panel's Save button wired up
      // until the user re-applies a journal system — not worth losing the rest of the plan over.
      const systemAddress = action.state.systemAddress ?? null;
      const starSystem = action.state.starSystem ?? "";
      // Same shim style for `economyPreferences` (added after `bodies`): a plan saved before it
      // existed just has no preferences set, not a broken/undefined lookup target.
      const economyPreferences = action.state.economyPreferences ?? {};
      // Same shim style for `systemResourceLevel` (added after `bodies`): re-run the same
      // detect-from-real-scan-data-or-default-to-Pristine resolution `JournalImportPanel`'s
      // `applySystem` does on a fresh import, rather than silently reverting to "unknown" (which
      // this field's whole point was to move away from) or blindly overriding real per-body data a
      // pre-existing plan already has.
      const resourceLevel = action.state.systemResourceLevel ?? systemResourceLevel(bodies) ?? "pristine";
      return {
        ...action.state,
        bodies,
        systemConfigured,
        systemAddress,
        starSystem,
        economyPreferences,
        systemResourceLevel: resourceLevel,
      };
    }
    case "reset":
      return INITIAL_FORM_STATE;
  }
}

/** Keeps the primary station's assigned body's Orbital-1 slot synced to a real, flagged
 * `presentFacilities` entry (see `PresentFacilitySlot.primary`'s doc comment /
 * `domain/presentFacilities.ts`'s `syncPrimaryIntoBodies`) — run after EVERY action, not just the
 * ones that touch `firstStationBuilding`/`firstStationBodyId`/`firstStationVariant`/
 * `firstStationCustomName` or `bodies` directly, so the invariant holds regardless of which action
 * path changed them: a `"patch"` from either dropdown, `"load"`ing a saved system that has no
 * synced entry at all (an older export, or one authored by hand — reconciled automatically the
 * moment it loads, no separate migration step needed), or any future action type. This matters
 * because a real facility can be manually entered in a body's Orbital 1 slot before that body is
 * ever assigned as the primary — the System facilities panel only stops *rendering* that slot once
 * a primary is assigned, it doesn't clear the data behind it — so without this reconciliation, that
 * stale entry would sit alongside the primary's own reservation and get double-counted. Aggregate
 * mode (`bodies` empty) has nothing to reconcile onto. */
function reconcilePrimarySlot(state: PlannerFormState): PlannerFormState {
  if (state.bodies.length === 0) return state;
  const bodies = syncPrimaryIntoBodies(
    state.bodies,
    state.firstStationBodyId,
    state.firstStationBuilding,
    state.firstStationVariant,
    state.firstStationCustomName,
  );
  return bodies === state.bodies ? state : { ...state, bodies };
}

export function plannerReducer(state: PlannerFormState, action: PlannerAction): PlannerFormState {
  return reconcilePrimarySlot(applyAction(state, action));
}

export const ALL_SCORES_LIST: Score[] = ALL_SCORES;

export interface PlannerResultState {
  status: "idle" | "solving" | "done" | "error";
  result: SolverResult | null;
  message: string | null;
}

export const INITIAL_RESULT_STATE: PlannerResultState = {
  status: "idle",
  result: null,
  message: null,
};
