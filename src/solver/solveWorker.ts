// Worker entry point for `solveInWorker.ts` — runs the actual HiGHS solve off the main thread, so
// the UI (and the "Running the solver…" progress sweep) stays responsive during a solve instead of
// freezing (the real `solve()` call is a fully synchronous WASM computation with no yielding — see
// `solve.ts`'s own header for why). Bundled as its own chunk by Vite's built-in Worker support
// (`new Worker(new URL("./solveWorker.ts", import.meta.url), { type: "module" })` in
// `solveInWorker.ts` — no plugin needed, Vite 8). Not imported directly anywhere else.

import { solve, type SolverInput, type SolverResult } from "./solve";

export type SolveWorkerResponse = { ok: true; result: SolverResult } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<SolverInput>) => {
  try {
    const result = await solve(event.data);
    self.postMessage({ ok: true, result } satisfies SolveWorkerResponse);
  } catch (err) {
    self.postMessage({ ok: false, message: (err as Error).message } satisfies SolveWorkerResponse);
  }
};
