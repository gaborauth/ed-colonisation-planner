# EDCP: Elite Dangerous Colonisation Planner

A browser-based planner for Elite Dangerous system colonisation. Give it your available construction
slots (or let it estimate them from an uploaded Journal file), pick an objective, and it uses a MILP
solver to work out which facilities to build — taking construction points, facility dependencies, and
the escalating cost of building multiple ports into account.

Runs entirely client-side: no backend, no account, nothing leaves your browser. The solver
([HiGHS](https://highs.dev/), via WebAssembly) runs locally against the data you enter.

## Using it

Open the app (see the GitHub Pages link at the top of this repo, or run it locally — see below) and:

1. **System panel** — enter your available orbital/ground/asteroid slots and current T2/T3
   construction points, or use **Import from journal** to upload an Elite Dangerous Journal `.log`
   file and get a starting estimate from your scanned system data. That estimate is a best-effort
   guess (see [Known limitations](#known-limitations)) and pre-fills editable fields — always sanity
   check it against your in-game System Map.
2. **Objective** — maximize a single system score (construction cost is minimized instead), or write
   a custom expression (`sqrt(w) + sqrt(n)`, `2*w + t - abs(w - 2*t)`, etc.) over the score letters
   `i m e t w n d c`.
3. **System score constraints** — optional min/max bounds per score.
4. **Buildings** — mark what's already present, and optionally pin per-building minimums/maximums.
   After solving, hover a building's total to see its contribution to each score.
5. Hit **Solve for a system**. Results show the resulting scores, remaining slots/points, and a
   feasible build order respecting dependencies and construction-point requirements.
6. **Saved plans** — save/load plans locally (browser storage), or export/import a plan as a file to
   move it between browsers.

## Known limitations

This is a from-scratch rewrite (see [History](#history)) of a tool that predates several game
balance changes, rebuilt against the current ruleset as best as could be verified from public
sources. A few pieces are explicitly best-effort and flagged as such in both the code and the UI:

- **Journal → slot estimate** (`src/journal/eligibility.ts`): no official formula for how scanned
  body data maps to buildable slot counts was locatable. The heuristic there is a reasonable guess,
  isolated in named constants for easy correction — if you compare it against a real System Map and
  it's off, that's the file to fix.
- **Subsequent-facility stat weighting** (`src/solver/solve.ts`, `SUBSEQUENT_FACILITY_WEIGHT`): only
  the claim/first station is confirmed to contribute full weight to system scores, with every other
  facility contributing less — the exact current percentages weren't confirmed from an authoritative
  source, so best-known figures are used and clearly marked.

If you have more accurate numbers for either, they're both single, well-commented constants to edit.

Also out of scope for now: the Update 3 facility-linking/commodity-economy rework (what's actually
buyable/sellable at a station) — this tool has only ever modeled the abstract system-score stats, not
commodity supply and demand.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # vitest — solver tests run the real HiGHS WASM solver, not mocks
npm run build    # production build to dist/
```

Deploys automatically to GitHub Pages on push to `main` via GitHub Actions
(`.github/workflows/deploy.yml`).

## Data source

Building stats and costs come from DaftMav's community-maintained
["Colonization Construction v3"](https://forums.frontier.co.uk/threads/v3-of-the-colonization-construction-spreadsheet-is-now-available.635762/)
spreadsheet.

## History

EDCP was originally a Python/Tkinter desktop application, built at colonisation's launch in March
2025. It's since been fully rewritten as this stateless web app — the original source is still
available in this repository's Git history for reference.

## Feedback

Issues and feature requests welcome.
