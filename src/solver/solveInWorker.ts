// Client-side entry point `App.tsx` calls instead of `solve()` directly, so the actual HiGHS solve
// (a fully synchronous, non-yielding WASM call — see `solve.ts`'s header) runs in a Web Worker
// instead of blocking the main thread/UI for the whole solve. `App.tsx` is the ONLY production call
// site that invokes `solve()` (confirmed via `grep -rn "\bsolve(" src` — everything else importing
// from `solve.ts` only imports types), so this is the only place that needed to change; `solve.ts`
// itself and every test that calls `solve()` directly are untouched.
//
// jsdom (used by component tests, including `App.test.tsx`) does not polyfill a global `Worker` —
// unlike `solve.ts`'s own Node-vs-browser WASM-loading check, which has to work around jsdom
// polyfilling `window`, a plain `typeof Worker === "undefined"` feature-detect here cleanly picks
// the direct-call fallback under test, exercising the exact same `solve()` path every existing test
// already relies on. No existing test needed to change because of this file.
//
// A fresh worker is created and terminated per call, matching `solve()`'s own existing behavior of
// loading a fresh HiGHS WASM instance on every call today — this doesn't add a new cost, just
// relocates the existing one off the main thread.

import { solve, type SolverInput, type SolverResult } from "./solve";
import type { SolveWorkerResponse } from "./solveWorker";

export async function solveInWorker(input: SolverInput): Promise<SolverResult> {
  if (typeof Worker === "undefined") {
    return solve(input);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./solveWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<SolveWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new Error(event.message || "Worker error"));
    };
    worker.postMessage(input);
  });
}
