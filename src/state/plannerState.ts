import { ALL_SCORES, type Score } from "../data/buildings";
import { normalizeFacilitySlots, type PresentFacilitySlot } from "../domain/presentFacilities";
import type { JournalBody } from "../journal/parser";
import type { Direction, SlotAvailability, SolverResult } from "../solver/solve";

// Exported (not just inlined into INITIAL_FORM_STATE below) so ObjectivePanel.tsx's "Default
// preset" entry can reference the exact same string — one source of truth, so the dropdown's
// "is this preset currently active" check (`expression === formState.customExpression`) can never
// silently drift out of sync with what a fresh session actually starts with.
export const DEFAULT_OBJECTIVE_EXPRESSION =
  "sqrt(i) + sqrt(m) + sqrt(e) + sqrt(t) + sqrt(w) + sqrt(n) + sqrt(d) + 2 * w + t - abs(w - 2 * t) + y";

export interface PlannerFormState {
  slots: SlotAvailability;
  /** Per-body layout from JournalImportPanel's "Apply slots and body layout to System facilities"
   * button. Empty => aggregate mode (today's exact behavior, `slots` above is the only capacity
   * input). Non-empty => per-body placement mode (see `solve.ts`'s `SolverInput.bodies`) — `slots`
   * above still gets kept in sync as the aggregate total for display/fallback purposes. */
  bodies: JournalBody[];
  /** Which saved journal system `bodies` came from — set by `JournalImportPanel`'s "Apply" button
   * alongside `bodies`/`slots`/`systemConfigured`. Lets the System facilities panel's own "Save"
   * button write already-built-facility edits back into `persistence/journalSystems.ts`'s store
   * without needing a separate manually-entered system identifier (every system's bodies come from
   * a journal import, never typed in by hand — see CLAUDE.md). Null until a system is applied. */
  systemAddress: number | null;
  starSystem: string;
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
}

export const INITIAL_FORM_STATE: PlannerFormState = {
  slots: { space: 0, ground: 0, asteroid: 0 },
  bodies: [],
  systemAddress: null,
  starSystem: "",
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
};

export type PlannerAction =
  | { type: "patch"; patch: Partial<PlannerFormState> }
  | { type: "setMapEntry"; map: "alreadyPresent" | "atLeast" | "atMost"; name: string; value: number | undefined }
  | { type: "setScoreBound"; bound: "scoreMin" | "scoreMax"; score: Score; value: number | undefined }
  | {
      type: "setFacilitySlot";
      bodyId: number;
      kind: "space" | "ground";
      index: number;
      slot: PresentFacilitySlot | null;
    }
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

export function plannerReducer(state: PlannerFormState, action: PlannerAction): PlannerFormState {
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
      return { ...action.state, bodies, systemConfigured, systemAddress, starSystem };
    }
    case "reset":
      return INITIAL_FORM_STATE;
  }
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
