// Multi-pass wrapper around `solveInWorker`, see `solve.ts`'s header comment (search
// "synergyKnownPortBodyIds") for why this exists: `economy_synergy` can only give a body real
// (rather than flat weak-link) economy-fit signal once that body is KNOWN to have a port, and
// within a single `solve()` call that knowledge is fixed before solving even starts. Re-solving
// lets a later pass use an EARLIER pass's own newly-built port-role placements as that knowledge —
// a heuristic fixed-point iteration around an exact solver, not itself an exact algorithm. `solve()`
// stays pure/single-shot; this file owns the pass loop and convergence logic so it's testable
// without React/DOM, matching `solveInWorker.ts`'s own separation from `App.tsx`.

import { isPortRole } from "../data/buildings";
import { solveInWorker } from "./solveInWorker";
import type { BuildingPlacement, SolverInput, SolverResult } from "./solve";

/** Fixed pass count `App.tsx` runs on every solve — not user-configurable, no UI control. Real
 * timing (2026-08-10, a ~6-year-old laptop, a ~97-slot system) found 5 passes takes ~7s, and that a
 * typical system's known-port set converges (see the fixed-point check below) well before reaching
 * even that many — so a higher cap costs little in the common case (most solves finish early
 * regardless) while giving real headroom to the less common system that needs more passes to settle.
 * `solveIteratively` itself stays generic over `passes` — this constant is only where the app chooses
 * not to expose that as a user-facing knob. */
export const ITERATIVE_SOLVE_PASSES = 20;

export interface IterativeSolveResult {
  result: SolverResult;
  passesRun: number;
  /** True when a pass reproduced the exact same known-port body set it was given as input — further
   * passes would re-solve an identical LP model, so the loop stopped before reaching `passesRun ===
   * requested passes`. False when the requested pass count was exhausted (or a non-optimal pass cut
   * the run short) without reaching that fixed point. */
  converged: boolean;
}

function portBodyIdsFromPlacements(placements: BuildingPlacement[]): number[] {
  const ids = new Set<number>();
  for (const placement of placements) {
    if (placement.count > 0 && isPortRole(placement.building)) ids.add(placement.bodyId);
  }
  return [...ids].sort((a, b) => a - b);
}

function sameBodyIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** Re-solves up to `passes` times, widening `SolverInput.synergyKnownPortBodyIds` on each pass with
 * the previous pass's own newly-built port-role placements. `passes <= 1` degenerates to exactly one
 * `solveInWorker` call with an empty `synergyKnownPortBodyIds` — byte-identical to calling
 * `solveInWorker` directly, so this is safe to use unconditionally as the sole solve entry point.
 * Widening the known-port set only ever moves `economy_synergy`'s objective coefficients (see
 * `solve.ts`'s doc comment on the field) — it can never change the feasible region — so a pass 2+
 * that comes back non-optimal is a transient solver-internal issue, not a consequence of this
 * feature; the last known-optimal result is returned instead of surfacing that as an error. */
export async function solveIteratively(
  input: SolverInput,
  passes: number,
  onProgress?: (pass: number, total: number) => void,
): Promise<IterativeSolveResult> {
  const total = Math.max(1, passes);
  let knownPortBodyIds: number[] = [];
  let lastOptimal: SolverResult | null = null;

  for (let pass = 1; pass <= total; pass++) {
    onProgress?.(pass, total);
    const result = await solveInWorker({ ...input, synergyKnownPortBodyIds: knownPortBodyIds });

    if (result.status !== "optimal") {
      return lastOptimal
        ? { result: lastOptimal, passesRun: pass - 1, converged: false }
        : { result, passesRun: pass, converged: false };
    }
    lastOptimal = result;

    const nextKnownPortBodyIds = portBodyIdsFromPlacements(result.placements);
    if (sameBodyIdSet(nextKnownPortBodyIds, knownPortBodyIds)) {
      return { result, passesRun: pass, converged: true };
    }
    // Recomputed fresh from this pass's own decisions each time, not a cumulative union across
    // passes — a body a later pass decides NOT to port on correctly drops back out, so a stale early
    // guess can never permanently bias later passes toward a worse local optimum.
    knownPortBodyIds = nextKnownPortBodyIds;
  }
  return { result: lastOptimal!, passesRun: total, converged: false };
}
