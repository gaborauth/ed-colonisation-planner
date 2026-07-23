# EDCP: Elite Dangerous Colonisation Planner

A stateless, client-only React web app that solves "what should I build in this colonisation
system?" via a MILP solver (HiGHS, compiled to WASM) running entirely in the browser. No backend, no
account — everything (solving, persistence) happens client-side.

## Origin story (read this before assuming anything about "the original")

This was a Python/Tkinter desktop app, built at colonisation's launch (Mar 2025), abandoned Apr 2025.
In 2026-07 it was fully rewritten in place as this TypeScript/React app because the game had moved on
significantly (Dodec Update Nov 2025, Trailblazers Update 3 Apr 2026) and the desktop GUI was replaced
with a browser-based one. **The Python source is gone from the working tree but still in Git history**
— `git log --diff-filter=D --summary | grep '\.py$'` finds the deletion commit if you need to see the
original `solver.py`/`data.py`/etc. Several files here have "Ported from X.py" comments explaining
where non-obvious logic came from; those comments are accurate provenance, not stale references.

## Architecture

```
src/
  data/buildings.ts       — the 54 buildings: stats, costs, T2/T3 points, dependencies
  domain/
    systemState.ts        — SystemState: tracks running points/scores/slots as buildings are added
    ordering.ts            — computes a feasible build order (dependency/point-respecting sequence)
  solver/
    expressionParser.ts    — safe recursive-descent parser for custom objective expressions
    objective.ts            — compiles parsed expressions into an LP-linearizable form
    lpExpr.ts / lpModel.ts — linear-expression algebra + LP-format model builder
    solve.ts                — the actual MILP: builds the model, calls HiGHS, parses the solution
  state/plannerState.ts    — the app's one useReducer (form state) living in App.tsx
  persistence/             — localStorage-backed: saved plans, saved journal systems
  journal/                 — parses uploaded Elite Dangerous Journal files, estimates buildable slots
  components/               — one component per UI panel, no component library
```

State management is a single `useReducer` in `App.tsx` — no Redux/Zustand/Context. There's no backend
and no server-side state; "stateless" refers to that, not to an absence of persistence (localStorage
is used deliberately for saved plans and saved journal systems).

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # vitest — several tests run the REAL HiGHS WASM solver, not mocks
npm run build    # production build to dist/
npx tsc -b       # typecheck only
npx oxlint       # lint
```

Deploys to GitHub Pages on push to `main` via `.github/workflows/deploy.yml` (build → test → deploy).

## Two explicitly unverified constants — don't "fix" these without new evidence

No official source for either was locatable (official docs/forums block automated fetching). Both
are deliberately isolated as named constants, flagged in code comments and in the UI, so they're easy
to correct once real data shows up — treat them as placeholders, not as settled facts:

- `SUBSEQUENT_FACILITY_WEIGHT` in `src/solver/solve.ts` — only the claim/first station is confirmed
  to contribute full stat weight to system scores; every other facility contributes at a reduced
  weight. The exact current percentages are best-known guesses.
- `GROUND_SLOT_RADIUS_THRESHOLDS` (and the rest of the heuristic) in `src/journal/eligibility.ts` —
  how scanned body data maps to buildable slot counts. No formula was locatable; this is a reasonable
  guess pre-filled into editable UI fields, never locked in.

## Gotchas worth knowing before touching the solver

- **The `highs` npm package's LP-text parser crashes (native WASM abort, not a graceful error) on
  `==` for equality constraints.** Use a single `=`. `lpModel.ts`'s `toLPFormat()` already translates
  this — don't reintroduce `==` if hand-editing LP-text generation.
- **`highs`'s WASM binary needs different loading strategies in Node vs. browser.** `solve.ts` checks
  for a real Node runtime (`globalThis.process.versions.node`) rather than `typeof window` — jsdom
  polyfills `window` but is still real Node underneath, so a `window` check picks the wrong branch
  under jsdom-environment component tests and breaks them.
- Dependency constraints are big-M reformulations (HiGHS's LP-text interface has no native indicator
  constraints like the original's SCIP backend did) — see the comment block at the top of `solve.ts`.
- Custom objective expressions go through a real parser (`expressionParser.ts` + `objective.ts`), not
  `eval()`. Nonlinear terms (`sqrt`, `ln`, `abs`, fractional powers) are compiled to an exact
  LP linearization via supporting tangent lines — only valid when the term is used in a direction that
  benefits the optimization (concave functions maximized, convex functions minimized); the compiler
  rejects the opposite case with a clear error rather than silently producing a wrong bound. Nested
  function calls (e.g. `ln(ln(e))`) aren't supported — an argument must be a linear expression.

## Testing conventions

- Solver tests call the real `solve()` end-to-end against real HiGHS WASM solves — no mocking the
  solver. This is deliberate: the LP-generation logic is exactly what's most likely to silently break.
- Component tests need `// @vitest-environment jsdom` at the top of the file (default environment is
  `node`, since several solver tests need real Node WASM loading and jsdom would pick the wrong
  branch per the gotcha above).
- `@testing-library/react` cleanup is wired explicitly in `src/test-setup.ts` (no `globals: true` in
  vitest config, so RTL can't auto-detect the test framework's `afterEach`).
- UI changes should be verified in an actual browser, not just component tests — this project doesn't
  have a committed browser-driving setup yet (Playwright was installed ad hoc, `--no-save`, during
  development sessions and isn't a project dependency). If you need to do this again and it's not a
  quick one-off, consider running `/run-skill-generator` to make it a proper reusable project skill.

## Data source

Building stats/costs come from DaftMav's community "Colonization Construction v3" spreadsheet
(currently v3.4.1). If it needs refreshing again: Google Sheets isn't reliably scrapable via
automated web fetch — ask for an ODS export instead, which a plain Python `zipfile` + `xml.etree`
script can parse directly against `content.xml` (no extra dependencies needed), reading the "Stats"
tab for the master building table.

## Deliberate scope boundaries (not gaps to "complete")

- **DaftMav/Scuffed community-tool text import/export** was dropped, not ported, when rewriting from
  the original Python tool. A future EDDN-based import is the intended replacement path, not restoring
  the old text format.
- **No commodity/link-economy modeling.** Trailblazers Update 3's facility-linking rework affects
  what's buyable/sellable at a station — this tool has only ever modeled the abstract system-score
  stats (security, tech level, wealth, standard of living, development level, population increase,
  construction cost), never commodities. That's intentional, not an oversight.
- **No construction-progress tracking.** The Journal doesn't contain real build-progress events; this
  tool answers "what should I build here", not "what have I built so far."

## Workflow constraints

- **Prefer real structural fixes over suppress** Only suppress a warning when there's genuinely
  no non-deprecated/non-unsafe alternative — and call that out explicitly rather than suppressing silently.
- **Summarize the plan in a good PR title and description.** Don't assume reviewers will read the
  code diff to understand the intent. Try to summarize the change in a few sentences and call out  
  any known limitations or follow-up work.
- **Maintain the current PR tasks in the TASKS.md** — don't assume the TASKS.md file is
  up to date, but do keep it up to date when you make changes. If you see a task in TASKS.md that
  is already done, mark it as done rather than deleting it silently. The user will review the
  TASKS.md file to track progress, and the user will ask you to clear tasks entirely when the work
  on the PR is done; in case of new PR starts or new work, remind the user to check the TASKS.md
  file accordingly.
