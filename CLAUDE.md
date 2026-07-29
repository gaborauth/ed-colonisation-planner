# EDCPS: Elite Dangerous Colonisation Planner & Solver

A stateless, client-only React web app that solves "what should I build in this colonisation
system?" via a MILP solver (HiGHS, compiled to WASM) running entirely in the browser. No backend, no
account — everything (solving, persistence) happens client-side. **One exception**: the "Spansh"
import tab depends on a small self-hosted CORS proxy (see `src/spansh/` below) — Journal-file import
remains fully backend-free either way.

This codebase is a TypeScript/React rewrite of an earlier Python/Tkinter desktop tool. Some files
carry "Ported from X.py" comments — accurate provenance, not stale references. The original Python
source is gone from the working tree but still in Git history if you need it.

## Architecture

```
src/
  data/buildings.ts       — the 54 buildings: stats, costs, T2/T3 points, dependencies, Update 3
                            Port/Facility role + tier + best-effort economy-type classification
  domain/
    systemState.ts        — SystemState: tracks running points/scores/slots as buildings are added
    ordering.ts            — computes a feasible build order (dependency/point-respecting sequence)
    economyOverrides.ts    — Update 3 body-attribute -> economy-type override/boost/decrease tables
    links.ts                — Update 3 Strong/Weak link topology, computed post-solve from placements
    presentFacilities.ts    — already-built-facility hard/demolishable split, T2/T3 seed derivation,
                              and "leave empty" blocked-slot normalization
    bodyHierarchy.ts        — reconstructs the star/planet/moon/sub-moon nesting from body-naming
                              convention, for the System facilities tree's display only (UI-only)
    solvedPlacement.ts       — turns a solved SolverResult back into a per-body/per-slot picture
                              (present/primary/new/demolished, each tagged with its build-order
                              number) for SolvedSystemPanel's read-only tree — also where a
                              demolish-then-rebuild-the-SAME-building pair gets reclassified as
                              "present" instead (see Gotchas)
    buildOrderTable.ts       — BuildOrderPanel's full per-row Built/Demolish/Planned ledger
                              (numbered, running T2/T3 total) — see Gotchas for why it costs every
                              row via ordering.ts/systemState.ts, never solve.ts's own new-port MILP
                              formula
    solvedLinks.ts           — merges a solved plan's already-present facilities (minus anything
                              demolished) with its newly-built ones before computing link topology
                              — SolverResult.placements alone is new-builds-only (see solve.ts)
    currentSystemScores.ts   — the CURRENT (not-yet-solved) system's score totals, plain-number
                              reweighted sum over already-present facilities — no MILP needed for a
                              fixed, already-built layout; feeds SystemConfigPanel's summary
  solver/
    expressionParser.ts    — safe recursive-descent parser for custom objective expressions
    objective.ts            — compiles parsed expressions into an LP-linearizable form
    lpExpr.ts / lpModel.ts — linear-expression algebra + LP-format model builder
    solve.ts                — the actual MILP: builds the model, calls HiGHS, parses the solution;
                              optionally per-body, including `economy_synergy`/`economy_preference`
                              score terms (see below) and per-slot "leave empty" blocking
    solveInWorker.ts / solveWorker.ts — runs `solve()` inside a Web Worker so the main thread (and
                              the "Running the solver…" dialog's own animation) doesn't freeze
  state/plannerState.ts    — the app's one useReducer (form state) living in App.tsx
  persistence/             — localStorage-backed: saved plans, saved journal systems, panel
                              fold/collapse state, the active custom-objective expression
  journal/                 — parses uploaded Elite Dangerous Journal files, estimates buildable slots
  spansh/                  — alternative system-import source (see "Spansh import" below):
                              api.ts (fetch wrappers against a self-hosted CORS proxy),
                              adapter.ts (Spansh `/dump/{id64}` JSON -> this app's own
                              JournalSystem/JournalBody shape, so the rest of the app never knows
                              the difference), types.ts
  components/               — one component per UI panel, no component library; FacilityInfo.tsx
                              (the "i" info icons) and SystemScoresSummary.tsx (score/points/slots
                              readout) are shared between "Actual facilities" and "Solved system";
                              SolverStatusDialog.tsx is the blocking modal for the solving/error
                              states (see Gotchas' Web Worker entry)
```

State management is a single `useReducer` in `App.tsx` — no Redux/Zustand/Context. There's no backend
and no server-side state (with the one exception noted above for Spansh import); "stateless" refers
to that, not to an absence of persistence (localStorage is used deliberately for saved plans, saved
journal systems, and panel fold state).

## Spansh import

`JournalImportPanel.tsx`'s "Import system" panel has two tabs: "Journal file" (upload a real Journal
log) and "Spansh" (search Spansh's public system database by name and load a starting point directly
— useful for a system not yet personally scanned). Both tabs feed the exact same shared `systems`
list, body/slot table, and `dispatch`/`applySystem` flow — the only thing that differs is how a
`JournalSystem` enters that list in the first place (`parseJournalScans` for the Journal tab,
`spansh/adapter.ts`'s `spanshDumpToJournalSystem` for the Spansh tab).

**Why a proxy at all**: neither of Spansh's endpoints used here sends CORS headers, so a direct
browser `fetch()` from this app's origin is blocked. The user runs a small self-hosted nginx CORS
proxy on their own K8s cluster (`https://spansh-proxy.iotguru.dev`, not part of this repo) that
forwards to `spansh.co.uk/api/...` and allowlists this app's real origins. `src/spansh/api.ts`
hardcodes that proxy's public URL as `SPANSH_PROXY_BASE` — if the proxy ever moves, that's the one
place to update.

**Two Spansh endpoints, two different jobs**: `GET /systems/field_values/name?q=...` is the real
typeahead/autocomplete endpoint for the Spansh tab's search-as-you-type combobox (`/search` is a
*different*, full-text-search endpoint, not used here). `GET /dump/{id64}` returns full per-body
data for the "Load" button, once a candidate is picked.

**Field mapping** (`spansh/adapter.ts`'s `spanshDumpToJournalSystem`): `/dump/{id64}` is a near-1:1
equivalent of real Journal Scan-event data per body — real small Frontier `bodyId`s (the main star
is `bodyId: 0`, matching a real Journal upload of the same system, so the two sources merge
correctly via `JournalImportPanel.tsx`'s `mergeBySystemAddress`), real `parents` chains (Journal's
`parseParents`, exported from `journal/parser.ts`, is reused as-is), rings, reserve level, landable,
gravity, surface temperature, atmosphere, tidal-lock, terraforming state, and bio/geo signals using
the same `$SAA_SignalType_Biological;`/`$SAA_SignalType_Geological;` key strings Journal's
`FSSBodySignals` event uses. Two adjustments: `radius` is km in Spansh's data vs. meters in
Journal's (`× 1000`), and a body can lack the `signals` key entirely (genuinely never scanned by
anyone in Spansh's database), which maps to `undefined` ("unknown", matching Journal's own
convention for an un-FSS'd body) rather than `false` ("confirmed absent").

**Star belts vs. planet rings**: Spansh names a planet's rings `rings` but a star's own belts
`belts` — `toJournalBody` reads `body.rings ?? body.belts ?? []` (Journal-file import is unaffected;
`journal/parser.ts` already uses one uniform `Rings` key for both). A star's belt is its own
separate, dedicated constructible location physically far from the star — modeled as a synthetic
`JournalBody` (`kind: "ring"`, one per named belt, synthesized by `journal/parser.ts`'s
`withRingBodies`, applied by both `parseJournalScans` and `spanshDumpToJournalSystem`), not extra
capacity on the star's own orbital slot(s). It shows up as its own row in `JournalImportPanel`'s
table and its own leaf node in `domain/bodyHierarchy.ts`'s tree. `eligibility.ts`'s
`estimateBodySlots` gives a star's own slot `asteroid: 0` unconditionally, and the ring body itself
`{space: 1, ground: 0, asteroid: 1}`. The belt's slot can ONLY ever hold an `Asteroid_Base`, not any
other space building (real-game-confirmed, 2026-07-28) — `solve.ts`'s `SolverBody.asteroidExclusive`
(set from `JournalBody.kind === "ring"` in `App.tsx`'s `buildSolverInput`) zeroes every
non-`Asteroid_Base` building's upper bound on such a body, on top of the pre-existing
`Asteroid_Base <= 0 when slots.asteroid === 0` rule. A ringed PLANET's or moon's own slot, by
contrast, keeps making that body's own orbital slot(s)
asteroid-eligible directly WITHOUT becoming exclusive (unchanged, since a planet's ring sits at the
planet itself rather than being a separate far-away location) — deliberately NOT generalized to the
star's dedicated-body treatment; `asteroidExclusive` is only ever set for a `kind: "ring"` body, never
a ringed planet. The ring body's own `rings` field self-references its own ring, so a port built
there still gets the "Has rings" Extraction economy override.

**Deliberately deferred**: auto-detecting already-built facilities from Spansh's per-body
`stations[]` list — the dump has real per-body station placement, but Spansh's station `type` string
can't disambiguate which of this app's ~6-18 sub-variants of Outpost/Settlement/Hub a station is.

**Deliberately minimal `raw`**: unlike the Journal parser (which keeps the whole raw `Scan` event),
`spanshDumpToJournalSystem` does NOT persist the whole Spansh dump body object (it carries a lot of
incidental commodity/market/faction data that would needlessly bloat every saved/exported system).
`raw` here only ever carries the one field anything in the codebase actually reads
(`economyOverrides.ts`'s `hasVolcanism` reads `raw.Volcanism`).

**Semantic caveat, not a code gap**: Spansh's signal/genus data is crowdsourced (whoever last
scanned that body in Spansh's own database), not necessarily *this player's own* scan — "known" here
means "known to Spansh," not "known to you in-game." Surfaced as a disclaimer in the Spansh tab's
own help text, not hidden.

**Switching between saved systems from the sticky toolbar**: `SystemPortabilityBar.tsx`'s toolbar
summary (next to "Live Demo") becomes a real `<select>` once more than one system is saved
(`persistence/journalSystems.ts`'s `listSavedSystems()`, read fresh every render), letting the user
switch between saved systems from either import tab without reopening the Import system panel.
Mount-time last-used-system auto-restore also lives here (`switchToSavedSystem`), guarded so it
never clobbers an already-active system.

## Per-slot "leave empty" blocking

`JournalBody.blockedSlots`/`SolverBody.blockedSlots` (`{ space: boolean[]; ground: boolean[] }`,
same index-alignment/padding convention as `presentFacilities`) marks a specific empty slot as
off-limits to the solver — distinct from setting a body's orbital/ground slot count to 0, which
removes the slot entirely rather than just excluding it from this particular solve. The System
facilities panel's "Leave empty" checkbox is only offered for a genuinely empty slot and disables
that slot's building `<select>` while checked, so the two states can never conflict. `solve.ts`'s
`countBlockedEmptySlots` only ever counts an index once it's confirmed empty in `presentFacilities`
too — a stale/conflicting entry can never double-subtract capacity — and is wired into the per-body
capacity constraint and every `slotsRemaining` computation. No aggregate-mode equivalent exists (no
per-slot concept to attach a block to there), and there's no display change for a blocked-but-empty
slot in the "Solved system" tree or Build order table (it already renders correctly as an ordinary
empty slot).

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

## Branching and releases

Branch flow: feature branches → `development` → `main`. Versioning is fully automated via
[semantic-release](https://semantic-release.gitbook.io/) (`.releaserc.json`,
`.github/workflows/release.yml`), driven by Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
via the `conventionalcommits` preset.

- **Push to `main`**: a real release — computes the next semver bump from commit history,
  regenerates `CHANGELOG.md`, bumps `package.json`'s `version`, commits both back
  (`chore(release): x.y.z [skip ci]`), tags, and publishes a GitHub Release with generated notes.
  `npmPublish` is disabled (`@semantic-release/npm` only bumps the local `version` field — this
  package is `private` and never goes to the npm registry).
- **Push to `development`**: dry-run only (`npx semantic-release --dry-run`) — logs what version
  *would* be released and validates commit messages, but never tags, commits, or publishes anything.
- First release (no prior tag) lands as `v1.0.0` regardless of the first-release commits' types.

**Known open risk, not yet verified**: `main` is branch-protected (PRs required to merge into it).
The `@semantic-release/git` step needs to push a commit directly to `main` after a merge lands; if
branch protection rejects a direct push from the default `GITHUB_TOKEN` (a likely outcome — the
pushing identity is the `github-actions[bot]` app, which typically has no bypass), the release
workflow's `Release` step will fail at the git-push stage. The workflow reads `secrets.RELEASE_TOKEN`
first, falling back to `secrets.GITHUB_TOKEN`, so the fix (if this happens) is a fine-grained PAT
belonging to an account with bypass rights, saved as the `RELEASE_TOKEN` repo secret — or a
branch-protection bypass entry for `github-actions[bot]`. Only confirmable by watching a real run in
Actions.

Dependency updates: Dependabot (`.github/dependabot.yml`) watches both `npm` and `github-actions`
ecosystems weekly, opening PRs against `development` with a `chore` commit prefix — `chore:` doesn't
trigger a semantic-release version bump on its own, keeping routine dependency bumps out of the
changelog unless a human recharacterizes one as a real `fix`/`feat`.

## Explicitly unverified/best-effort constants — don't "fix" these without new evidence

Deliberately isolated as named constants, flagged in code comments and in the UI, so they're easy
to correct once better data shows up — treat them as placeholders, not as settled facts. Two are
genuinely unverified (no official source found); the rest are official-source-*derived* but require
an inference this project made itself, not something the source stated verbatim:

- `SPANSH_PLANET_CLASS_MAP` and the star-type classifier in `src/spansh/adapter.ts` — translates
  Spansh's `subType` wording to Journal's exact `PlanetClass`/`StarType` strings so
  `economyOverrides.ts`'s exact-match predicates (`isRockyIce`, `isWaterWorld`, `isAmmoniaWorld`,
  etc.) still fire correctly. Built from general Elite Dangerous domain knowledge covering every
  known planet class, but only actually verified against the classes present in one committed real
  fixture (`spansh-jsons/swoilz-aw-c-d52-dump.json`) — e.g. Spansh's `"Rocky Ice world"` must become
  `"Rocky ice body"` or `isRockyIce` silently never fires. Revise/extend if a differently-worded
  `subType` shows up in a future real system.
- `GROUND_SLOT_RADIUS_THRESHOLDS` (and the rest of the heuristic) in `src/journal/eligibility.ts` —
  how scanned body data maps to buildable slot counts. The ground-slot half is sourced from
  community research (CMDR Nyatto, Flynnvali, and others — see also the Raven Colonial tool for the
  most current version); the orbital-slot half's own base count (flat 1 per star/planet) has no
  known per-body formula — community reports describe it as scaling with overall system body count,
  but no formula was found. Pre-filled into editable UI fields (with a "Reset slots to guess"
  button), never locked in. Asteroid eligibility is partially confirmed (in-game, STAR belts only —
  see "Spansh import" above); a ringed PLANET's own slot keeps the original, still-unconfirmed
  eligibility behavior. The real game can show multiple numbered "Cluster N" locations per named
  belt, uncountable from scan data — this models one slot per named belt, a best-effort floor like
  every other slot count here.
- `FACILITY_ECONOMY_GUESS` in `src/data/buildings.ts` — maps Hub/Settlement/Installation buildings
  to Update 3 economy types. The official body-attribute override table is verbatim-sourced (see
  below), but no official per-building economy mapping was ever published — this mapping is inferred
  from naming; some buildings are deliberately left unmapped rather than guessed.
- `PORT_FIXED_ECONOMY` in `src/data/buildings.ts` — the subset of `PORT_ROLE_BUILDINGS` with a
  fixed, non-"Colony" economy instead of the body-attribute-override behavior every other port gets
  (e.g. a Military Outpost is always 100% Military regardless of the body). Mostly *not* a guess —
  sourced verbatim from `DaftMav-v3.4.1.ods`'s "Stats" tab, "Facility Economy" column, and confirmed
  in-game for the two entries the sheet doesn't cover cleanly: `Civilian_Outpost`/`Commercial_Outpost`
  (space) and `Civilian_Planetary_Outpost` (ground) are deliberately left OUT of this table (they
  take the body-derived economy like generic ports, confirmed in-game). Known gap:
  `Criminal_Outpost`'s sheet economy is "Contraband," not one of this app's 9 `EconomyType` values at
  all — left out of this table, falling through to the Colony-default approximation.
- `BOOST_DECREASE_DELTA`/`ECONOMY_RATIO_FLOOR_PERCENT` in `src/domain/economyOverrides.ts` (the
  System facilities panel's per-facility "Economy ratios" hover) — the ±40-percentage-point-per-
  condition and 10% floor magnitudes are community-sourced (`EconomicEffects.ods`'s "Lookups -
  Innates and Modifiers" sheet), not an official Frontier-published number; the official patch notes
  only say boosts/decreases exist, never by how much. Cross-validated against several real reported
  in-game values (Agriculture 140%/100% with/without organics, Extraction/Industrial 140% from
  system resources) before landing, but still the kind of number this section exists to flag.
- `TERRAFORMABLE_AGRICULTURE_BUG_NOTE` in `src/domain/economyOverrides.ts` — the official patch
  notes and `EconomicEffects.ods` both list a Terraformable body as an Agriculture strong-link boost
  condition, but real-game testing found it has no observable effect on Agriculture's actual value,
  suspected to be a Frontier bug rather than a documentation error. Deliberately excluded from every
  boost/decrease computation in that file so displayed values match observed game behavior, not the
  patch notes; surfaced as a one-line disclaimer next to the body-info hover, linking to
  `public/known-issues.html` (`TERRAFORMABLE_AGRICULTURE_BUG_LINK`) for the full explanation. Revert
  by re-adding the `isTerraformable(body)` boost call at each of the three sites if Frontier ever
  fixes this in-game.
- `LINK_TIER_CONTRIBUTION_RATE` (0.4/0.8/1.2) and `WEAK_LINK_CONTRIBUTION` (flat 0.05) in
  `src/domain/links.ts` — how much of a linked economy a facility/port contributes *to a linked
  port* through a strong or weak link respectively (distinct from `BOOST_DECREASE_DELTA` above,
  which is about a facility's *own* displayed ratio). The tier-scaled strong-link number is
  community-sourced (`EconomicEffects.ods`'s "Strong Link Modifiers" sheet); the flat weak-link 5%
  is a user-supplied rule with no official-source equivalent at all. Both cross-validated against a
  real in-game system's exact reported percentages/counts (see `links.test.ts`'s two dedicated
  regression tests).
- `economy_synergy` (`src/solver/solve.ts`'s `economySynergyCoefficient`, objective letter `y`) — a
  genuinely new approximation, not from a source table at all: for a candidate (building, body) pair
  on a body already known (before solving) to have a port — a present one, or the primary station's
  assigned body — it applies the verbatim strong-link boost/decrease table as if a strong link had
  already formed there. For any OTHER body, it applies only a flat, body-attribute-independent
  `WEAK_LINK_CONTRIBUTION` per economy the building carries, since a body with no confirmed port can
  only ever weak-link elsewhere in the real mechanic. Still NOT the same thing as
  `domain/links.ts`'s real post-solve `computeSystemLinks` (which the "i" info icons use, via
  `domain/solvedLinks.ts`, and DOES know the true link graph once a layout is solved) — whether the
  solver will ALSO build a brand-new port on a currently-port-less body is itself a decision
  variable, so "known port" here means "known before solving," a conservative approximation in both
  directions. If a future change makes exact link-graph-aware MILP scoring tractable, replace this
  with that instead of layering more approximation on top.
- `ECONOMY_PREFERENCE_WEIGHT` (flat 0.5) in `src/solver/solve.ts` — the per-(building, body) pull of
  a Want/Don't-want `economyPreferences` entry (`economy_preference`, objective letter `p`; see
  "Per-economy Must/Want/Don't want/Forbid preference controls" below). Purely user-supplied, no
  source at all — a direct preference nudge with no in-game equivalent to validate against. Chosen
  to sit in the same order of magnitude as `economy_synergy`'s own deltas (0.05 weak-link trickle,
  0.4 per boost/decrease condition, 0.4–1.2 full strong-link tier contribution) so one preferred
  building's pull is comparable to a single real link-boost, not negligible or overwhelming.

## Manual "System resource level" override

`domain/economyOverrides.ts#systemResourceLevel` only ever learns a system's real `ReserveLevel`
(Pristine/Major/Common/Low/Depleted) by scanning every body's `reserveLevel` field for one that
classifies — a real-in-game system-wide fact reported on a ringed body's own Scan event (see the
Update 3 section above). Some real systems have no per-body `reserveLevel` at all — no ringed body
was scanned closely enough via Journal, or Spansh's `/dump` response simply omits it even for a
system with a real scanned belt/ring (confirmed: `spansh-jsons/swoilz-eg-i-b2-3-dump.json` has a
real star belt but zero `reserveLevel` occurrences anywhere in the dump) — which used to report
"unknown," silently zeroing the Extraction/Industrial/Refinery boost-decrease. Most colonizable
systems are actually Pristine (real-game observation; exceptions cluster in the inner bubble), so a
manually-editable "System resource level" dropdown (`SystemConfigPanel.tsx`'s "Actual facilities in
the system" panel, gated by the same `locked`/`hasBodies` per-body-mode-only pattern as the panel's
other fields) defaults to Pristine instead of blocking on missing data — same "calibrate, don't
block" precedent as this file's other best-effort constants, though this one is a user-editable
field, not a hardcoded constant.

- **`ResourceLevel` type** (`"pristine" | "major" | "common" | "low" | "depleted"`,
  `domain/economyOverrides.ts`) — `"common"` is a real, neutral, confirmed reading, DISTINCT from
  `null` ("no data scanned at all"); `classifyReserveLevel` used to conflate the two (a real latent
  bug, fixed alongside this feature), which would have made a real "Common" reading show the same
  "unknown" messaging as no data at all.
- **`PlannerFormState.systemResourceLevel`** always has a value (default `"pristine"`, never
  `null`/optional at the form-state layer). `JournalImportPanel.tsx`'s `applySystem` seeds it from
  real per-body detection (`systemResourceLevel(system.bodies) ?? "pristine"`) on every import/
  apply — matching "auto-set when the import has the data, default otherwise" — then it's freely
  user-editable afterward. `plannerState.ts`'s `"load"` action re-runs the same detect-or-default
  resolution for an old saved plan that predates this field, rather than silently reverting to
  "unknown" or blindly overriding real per-body data a pre-existing plan already has.
- **Threading into scoring without new function parameters**: `domain/economyOverrides.ts#
  applyManualResourceLevel(bodies, manualLevel)` returns `bodies` completely unchanged when real
  per-body detection already finds a level (real scan data always wins) — otherwise returns a
  shallow copy with the manual level injected onto exactly one body's `reserveLevel` field (the
  same "smeared system-wide fact, doesn't matter which body carries it" simplification
  `systemResourceLevel` itself already applies to real data, not a new one). This lets every
  existing `systemResourceLevel`-scanning call site (`computeBoostDecrease`, `computeEconomyRatios`,
  `computeColonyEconomyBreakdown`, `computeStrongLinkBreakdown`, and `links.ts`'s
  `computeSystemLinks`) pick it up with zero signature changes — callers instead wrap their
  `JournalBody[]` once at the point they already assemble one: `solve.ts` wraps `allEconomyBodies`
  right where `economySynergyCoefficient` builds it (new optional `SolverInput.systemResourceLevel`,
  defaulting to `"pristine"` when omitted — same backward-compatible degrade pattern as
  `SolverBody.economy` itself), and `SystemConfigPanel.tsx`/`SolvedSystemPanel.tsx` each wrap the
  `formState.bodies` they'd otherwise pass as `allBodies`/into `computePresentSystemLinks`/
  `computeSolvedSystemLinks` into one memoized `effectiveBodies`, used everywhere in place of the
  raw array (harmless for the many other places in those components that don't care about
  `reserveLevel` at all — the wrapped copy differs from the original only in that one field on one
  body).

## Per-economy Must/Want/Don't want/Forbid preference controls

`ObjectivePanel`'s "Economy preferences" section (a foldable sub-section, collapsed by default,
right after "Score constraints") lets the user steer *which* `EconomyType`s the solver favors or
avoids, on top of the aggregate score-based objective — a 5-state per-`EconomyType` choice (Must /
Want / Dunno / Don't want / Forbid) as a radio-button grid (one column per option, one row per
economy). `PlannerFormState.economyPreferences` / `SolverInput.economyPreferences`
(`Partial<Record<EconomyType, EconomyPreference>>`, absent per economy = "Dunno", the unbiased
default). Reuses `domain/economyOverrides.ts#facilityBaseEconomies(buildingName, body.economy)` —
the same per-(building, body) economy-set lookup `economy_synergy` already uses — to know which
`bodyVars[name][bodyId]` decision variables carry a given economy; all four states are computed in
the same per-body loop `solve.ts` already runs for `economy_synergy`.

- **Scoped to per-body mode only**, same as `economy_synergy`: `solve.ts` silently ignores
  `economyPreferences` when `input.bodies` is absent/empty; `ObjectivePanel`'s section shows a
  disabled explanatory hint instead of the per-economy table when `formState.bodies` is empty.
- **Forbid** (hard): zeroes every `bodyVars[name][bodyId]` whose `facilityBaseEconomies` includes
  the forbidden economy. The pre-existing `body_split_<name>` equality constraint means zeroing
  every body's slot for a building automatically zeroes its port-slot variables too.
- **Must** (hard): `sum(every qualifying bodyVar) >= 1` per Must economy. Does NOT offset against
  already-present facilities already carrying the economy — a documented limitation, not an
  oversight. An economy with zero eligible (building, body) pairs anywhere naturally reports
  `status: "infeasible"` through HiGHS, same as every other hard constraint in this file.
- **Want / Don't want** (soft): contribute `± ECONOMY_PREFERENCE_WEIGHT` into a **separate** derived
  score, `economy_preference` (objective letter `p`) — deliberately NOT folded into `economy_synergy`
  itself, so a user's manual preference bias can never silently distort `economy_synergy`'s
  real-link-mechanic approximation. Applied unconditionally per qualifying (building, body) pair,
  unlike `economy_synergy`'s boost/decrease table. `state/plannerState.ts`'s
  `DEFAULT_OBJECTIVE_EXPRESSION` includes `+ p` alongside `+ y`, so Want/Don't want only actually
  bias a solve when the active objective references `p`.
- **Port-stacking caveat, surfaced in the UI, not hidden**: a generic port's Colony-derived economy
  set is body-attribute-driven and stacks (e.g. every port on an Earth-like world carries
  Agriculture + High Tech + Military + Tourism together, non-selectably) — Forbidding one of those
  economies rules out every generic port option on that body, not just that one economy. A
  `PORT_FIXED_ECONOMY` port (e.g. `Military_Outpost`) is unaffected unless its own fixed economy
  also matches. Intended MILP consequence of the existing body-attribute override table, not a bug.

## Gotchas worth knowing before touching the solver

- **The `highs` npm package's LP-text parser crashes (native WASM abort, not a graceful error) on
  `==` for equality constraints.** Use a single `=`. `lpModel.ts`'s `toLPFormat()` already translates
  this — don't reintroduce `==` if hand-editing LP-text generation.
- **`highs`'s WASM binary needs different loading strategies in Node vs. browser.** `solve.ts` checks
  for a real Node runtime (`globalThis.process.versions.node`) rather than `typeof window` — jsdom
  polyfills `window` but is still real Node underneath, so a `window` check picks the wrong branch
  under jsdom-environment component tests and breaks them.
- **`highs.solve(lpText, ...)` is a fully synchronous WASM call with no yielding — it blocks the JS
  main thread for the whole solve.** Fixed by running the actual solve in a Web Worker: `App.tsx`
  calls `solver/solveInWorker.ts`'s `solveInWorker()` instead of `solve()` directly, which posts the
  `SolverInput` to `solver/solveWorker.ts` (a separate worker entry point Vite bundles as its own
  chunk, no plugin needed) and resolves with the returned `SolverResult`. `solve.ts` itself is
  untouched — `App.tsx` is the ONLY production call site that invokes `solve()` directly.
  `SolverInput`/`SolverResult` are plain structured-clone-safe data, so `postMessage` works with no
  adapter layer. `solveInWorker()` feature-detects `typeof Worker === "undefined"` and falls back to
  calling `solve()` directly when there's no real `Worker` (jsdom, used by component tests, doesn't
  polyfill one). A fresh worker is created and terminated per call. `App.tsx`'s
  `SolverStatusDialog.tsx` is a full-screen blocking modal (not the old inline banner) for the
  "solving"/"error" states, with a real animated progress bar so it visibly reads as "still working."
- Dependency constraints are big-M reformulations (HiGHS's LP-text interface has no native indicator
  constraints like the original's SCIP backend did) — see the comment block at the top of `solve.ts`.
- Custom objective expressions go through a real parser (`expressionParser.ts` + `objective.ts`), not
  `eval()`. Nonlinear terms (`sqrt`, `ln`, `abs`, fractional powers) are compiled to an exact
  LP linearization via supporting tangent lines — only valid when the term is used in a direction that
  benefits the optimization (concave functions maximized, convex functions minimized); the compiler
  rejects the opposite case with a clear error rather than silently producing a wrong bound. Nested
  function calls (e.g. `ln(ln(e))`) aren't supported — an argument must be a linear expression.
- **`SolverBody.slots` is a body's TOTAL physical slot count, not "remaining capacity."** `solve.ts`
  computes remaining capacity itself from each body's `presentFacilities`.
- **Already-present ports have no recorded real build order**, but the escalating T2/T3 port cost
  curve (`getT2PortCost`/`getT3PortCost`) is order-dependent — `domain/presentFacilities.ts`'s
  `computePresentPortsSeed` picks a deterministic stand-in order (by body, space before ground, then
  slot index) to charge their historical cost into the T2/T3 starting balance — an approximation,
  not a bug.
- **Tier-2-cost ports (Coriolis, Asteroid_Base) and Tier-3-cost ports (Orbis_or_Ocellus,
  Dodecahedron, Planetary_Port) escalate along INDEPENDENT sequences** (real-game-confirmed).
  `domain/systemState.ts`'s `constructionPoints` counts same-tier predecessors only, correctly.
  **`solve.ts`'s own new-port MILP cost model still shares ONE global sequential slot index across
  all 5 escalating port types**, not a per-tier index — left as-is deliberately: the shared global
  index is always >= the true same-tier count, and both cost curves are monotonically increasing, so
  this can only ever OVER-estimate cost (conservative/suboptimal, never accepts a plan that's
  actually infeasible in-game). Revisit only if a solved plan's port cost looks implausibly high with
  a mixed already-present port-tier set — fixing it properly means giving Tier-2 and Tier-3 ports
  their own separate sequential slot-index sequences, a bigger MILP restructuring.
- **`domain/buildOrderTable.ts` deliberately costs every row via `ordering.ts`/`systemState.ts`'s
  per-tier math, never `solve.ts`'s own new-port MILP formula from the entry above** — that formula's
  per-k feasibility check tests an AGGREGATE condition ("if every non-port contribution were
  available up front, does paying for k+1 ports in some order stay non-negative"), not a genuine
  step-by-step sequence; replaying it in build order can dip the running T2/T3 total negative even
  when a valid, always-executable order exists. `computeFeasibleOrder`'s per-tier, canBuild-gated
  math is what actually GUARANTEES an executable sequence, matching this app's existing precedent
  (`BuildOrderPanel`/`SolvedSystemPanel` treat `ordering.ts`'s own computed order as authoritative
  for display, never `solve.ts`'s raw internal port assignment). Consequence: this table's own final
  running T2/T3 total can legitimately end up higher than `result.finalT2Points`/`finalT3Points`,
  never lower — surfaced via the panel's own caption, not silently. A present facility the solver
  demolishes still shows up as a real Built row first (real, standing infrastructure today) before
  its Demolish row subtracts it back out. Demolish and Planned rows are interleaved, not "all
  demolishes then all planned builds" — `scheduleDemolishAndPlanned` defers any demolish that would
  currently go negative until a Planned (rebuild) row has grown the balance back up, using
  `SystemState.canDemolish`/`removeBuilding` (the demolish-side counterparts to
  `canBuild`/`addBuilding`) — demolition itself is never blocked by insufficient points in the real
  game (points are refunded on demolition), so this reordering never changes what's achievable, only
  the display order. `ordering.ts`'s port queue searches its WHOLE list for anything currently
  buildable (not just the head element), and `SystemState.addResult`'s stand-in-order crediting for
  already-present ports is floored at 0 internally (a real player's balance can never actually be
  negative) — both matter under heavy demolition, where few other present facilities are left to
  "explain" how already-present ports were affordable.
- **A demolish-then-rebuild-the-SAME-building pair is reclassified as `"present"` (untouched),
  not shown as a wasteful demolish+rebuild.** `domain/solvedPlacement.ts`'s slot-seating algorithm
  assigns new-build units to freed/empty slots via a fixed, arbitrary order — it can coincidentally
  hand a just-demolished slot a new unit of the IDENTICAL building type, which would be real wasted
  in-game commodity cost for zero net benefit (same stats/T2/T3 either way). When
  `newBuilding.building === demolished.building`, `computeSolvedPlacements` classifies the slot as
  `"present"` instead, carrying forward the original nickname/variant. This is deliberately a
  DISPLAY-layer fix only — `SolverResult.toBuild`/`placements`/`demolished` are left untouched.
  `domain/buildOrderTable.ts` derives BOTH its Demolish and Planned rows from this SAME
  `computeSolvedPlacements` call (not from raw `result.demolished` separately), so the two panels
  can't disagree about which pairs got cancelled. Known, accepted trade-off: in the rare case a
  collision is genuinely unavoidable, `BuildingsTable.tsx`'s `toBuild`-sourced "Built" column can
  read 1 higher than what's actually visible as newly built, and a tree "build #N" sequence can show
  a small gap — both cosmetic, not worth the added complexity of also correcting `SolverResult`.
- **`SolverResult.slotsRemaining` subtracts present/primary occupancy, not just new builds.**
  `usedSlots.space`/`.ground`/`allVars.Asteroid_Base` are the raw NEW-BUILD decision-variable sums —
  correct as-is for the per-body capacity constraint, but `slotsRemaining` additionally subtracts
  present-hard + present-kept-and-not-demolished + the primary's reserved slot, and any per-slot
  "leave empty" blocks (see above). The `asteroid` figure counts ANY building on a ring-eligible
  body, not just `Asteroid_Base` specifically, since asteroid-eligible slots are a SUBSET of
  ordinary orbital slots, not a separate pool.
- **The primary station is a real, synced `PresentFacilitySlot` entry, not a separate "+1"
  convention.** `PlannerFormState`'s flat `firstStationBuilding`/`firstStationBodyId`/
  `firstStationVariant`/`firstStationCustomName` fields are the actual source of truth (still
  required — needed even in aggregate mode, which has no `bodies` array to attach a slot entry to at
  all), but are ALSO copied into a real `presentFacilities.space[0]` entry flagged
  `PresentFacilitySlot.primary: true`, kept correct via `domain/presentFacilities.ts`'s
  `applyPrimaryReservation`/`syncPrimaryIntoBodies` — `state/plannerState.ts`'s `plannerReducer`
  wraps every action with `reconcilePrimarySlot`, and `solve.ts` calls the same sync independently on
  its own `presentBodies` construction (so a direct/API caller bypassing the reducer, e.g.
  `solve.test.ts`, still gets a correct result). `computeHardNonPortSeed`/`computePresentPortsSeed`
  skip a `primary: true` ref entirely (its T2/T3 contribution is handled by
  `deriveCurrentPoints`/`solve.ts`'s own separate logic). **Any new call site that consumes
  `presentFacilities`/`derivePresentCounts`/`toBuildingPlacements` and independently accounts for
  the primary elsewhere needs an `excludePrimary: true` option (or a `!slot.primary` filter) to avoid
  double-counting** — existing examples: `SystemConfigPanel.tsx`'s `computeCurrentSystemScores` call,
  `state/toPlanResult.ts`, `domain/solvedLinks.ts`'s `toSolvedBuildingPlacements`,
  `domain/buildOrderTable.ts`'s `presentBuildOrderHint`/`presentInstanceQueues`.
  `domain/presentLinks.ts`'s dominance tie-break and `domain/solvedPlacement.ts` deliberately do NOT
  filter it out (the former wants the primary in its tie-break; the latter resolves the primary via
  its own independent `result.firstStationBodyId` check and never reads the synced entry).

## Testing conventions

- Solver tests call the real `solve()` end-to-end against real HiGHS WASM solves — no mocking the
  solver. This is deliberate: the LP-generation logic is exactly what's most likely to silently break.
- Component tests need `// @vitest-environment jsdom` at the top of the file (default environment is
  `node`, since several solver tests need real Node WASM loading and jsdom would pick the wrong
  branch per the gotcha above).
- `@testing-library/react` cleanup is wired explicitly in `src/test-setup.ts` (no `globals: true` in
  vitest config, so RTL can't auto-detect the test framework's `afterEach`).
- **`npx vitest run src/App.test.tsx` (run alone) occasionally fails with `[vitest-pool]: Failed to
  start forks worker for test files ... Timeout waiting for worker to respond`, 60s wall, before any
  test even starts.** Not a real test failure — it's Vitest's own hardcoded, non-configurable 60s
  worker-ready timeout getting tripped by how long it takes to transform/import this file's whole
  dependency graph (the whole app, plus the HiGHS WASM solver's jsdom fallback path) under jsdom,
  worsened by this working directory being a Windows drive mounted into WSL2 over `9p` (measurably
  slow for many-small-file access patterns, unlike a native Linux filesystem). Not fixable via
  `vitest.config.ts` (the timeout isn't configurable) or `test.pool` choice (tried `'threads'`, no
  difference). When this happens, just retry the same command, or bundle the flaky file with a
  second test file in the same `vitest run` invocation — both reliably work around it. See the
  Workflow constraints section below for when to actually run this file at all.
- UI changes should be verified in an actual browser, not just component tests — this project doesn't
  have a committed browser-driving setup yet (Playwright was installed ad hoc, `--no-save`, during
  development sessions and isn't a project dependency). If you need to do this again and it's not a
  quick one-off, consider running `/run-skill-generator` to make it a proper reusable project skill.
- **`jsons/swoilz-aw-c-d52.json` is a real exported system (the user's own, committed to the repo —
  see `SystemPortabilityBar.tsx`'s export format) and is always fair game as a test-data source.**
  Free to read it directly, load it in an ad-hoc reproduction script (a temporary `src/_debug.test.ts`
  run via `vitest run` and deleted afterward), or reference in a real regression test. It's real,
  played-out in-game data — already-built facilities, real body attributes, a real primary station —
  so it's also the go-to way to cross-check this app's computed numbers (scores, links, slot counts,
  T2/T3 balance) against actual reported in-game values; don't hesitate to reach for it first instead
  of constructing a synthetic fixture from scratch. If more `jsons/*.json` files show up locally
  later, treat them the same way unless told otherwise.
- **`src/realSystems.test.ts`** makes the above permanent and automatic instead of ad hoc:
  `describe.each` over every `*.json` file actually present in `jsons/` (dropping in another real
  exported system extends this suite with zero code changes), each run through the exact same
  pipeline a real "Solve for a system" click plus the "Solved system" panel's own post-solve
  computations perform — `solve()` with the app's real default objective (via `App.tsx`'s exported
  `buildSolverInput`, not a hand-rolled reconstruction), then build order
  (`getOrderingFromResult`) + link topology (`computeSolvedSystemLinks`) + per-slot placement seating
  (`computeSolvedPlacements`). Asserts: `slotsRemaining`/T2/T3 never negative, build order never
  throws, links never throw, `computeSolvedPlacements`'s `warnings` stays empty. Deliberately the
  broadest smoke test in the project — closer to `App.test.tsx`'s end-to-end spirit than a narrow
  unit test, but without a DOM so it can run fast and `describe.each` cheaply over many systems.
  `tsconfig.app.json` needed `"node"` added to its `types` array for this file's `node:fs`/`node:path`
  usage.
- **`spansh-jsons/swoilz-aw-c-d52-dump.json`** is a real Spansh `/dump/{id64}` response for the same
  real system as `jsons/swoilz-aw-c-d52.json` above, committed for the same reason — free to use
  directly in tests or an ad-hoc reproduction script. `src/spansh/adapter.test.ts` and
  `src/spansh/realSpanshSystem.test.ts` (the Spansh-path sibling of `realSystems.test.ts`, not folded
  into its `describe.each` since the input shape differs) both use it.
  `spansh-jsons/swoilz-aw-c-d52-query.json` (a `/systems/field_values/name` typeahead response) is
  also committed and used by the same tests.

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
- **Link topology + economy types are modeled; real commodity supply/demand is not.** See "Update 3
  link/economy modeling" below for what's actually implemented. Exact tradeable quantities (what's
  buyable/sellable, in what amount) are still never modeled — only the qualitative topology.
- **No construction-progress tracking, and only a limited demolition mechanic.** The Journal
  doesn't contain real build-progress events; this tool still answers "what should I build here",
  not "what have I built so far" — there's no weekly-tick timing, no mission tracking, no
  partial/in-progress construction. What *does* exist: the System facilities panel lets the user
  mark an already-built facility "demolishable," and the solver may then choose to remove it
  (refunding its stat/T2/T3 contribution and freeing its slot) if replacing it scores better — see
  `domain/presentFacilities.ts` and `solve.ts`'s `presentKeepVars`. This is a deliberately narrow
  slice of the real game's full demolition/cancellation mechanics (see below): no refund timing, no
  mission deletion, and the 5 escalating-cost-curve port buildings (`isPort()`) are never
  demolishable — unwinding the escalating T2/T3 cost curve's build-order dependence for a removable
  port wasn't worth the complexity, and settlements/hubs/installations are the actually useful case
  anyway.

## Update 3 link/economy modeling

Sourced from official Frontier patch notes: the original Update 3 link/economy rework, a
station-service activation-rules follow-up, the Type-11 update (demolition mechanics, see above),
and the Dodec Update (sourced the `FIRST_STATION_BONUS`/`SUBSEQUENT_FACILITY_REDUCTION` numbers).
This is the basis for `data/buildings.ts`'s `FACILITY_ECONOMY_GUESS`/`PORT_ROLE_BUILDINGS`/
`getPortTier` and all of `domain/economyOverrides.ts`, `domain/links.ts`.

### Verbatim rules (implementation should match these exactly)

**Ports vs Supporting Facilities**: Ports = Outposts, Coriolis/Orbis/Ocellus Stations, Asteroid
Bases, Planetary Ports, Planetary Port Outposts. Supporting Facilities = Settlements, Installations,
Hubs.

**Strong vs Weak links**: Strong links form between a port and any facility on/around the same body,
and between multiple ports on the same body (highest tier wins; ties broken by build order, earlier
wins). If a body has both a planetary and a space-based port: planetary facilities strong-link to
the planetary port, which passes those links onward to the orbital port (same tier/order priority).
Weak links form between ports and facilities on *different* bodies in the same system. Both link
types can coexist (one facility can supply several ports). Links only ever form port↔facility or
port↔port — never facility↔facility. A port can carry multiple economy types at once; each
additional type via a link proportionally introduces trade in that type.

**Strong-link boost/decrease table** — only strong links are affected, weak links never are:
| Economy | Boosted by | Decreased by |
|---|---|---|
| Agriculture | orbiting an ELW; on/orbiting a terraformable body; on/orbiting a body with organics | on/orbiting an icy body; a planet tidally locked to its star; a moon tidally locked to its planet whose parent chain up to the star is also tidally locked |
| Extraction | system has major/pristine resources; on/orbiting a body with volcanism | system has low/depleted resources |
| High Tech | orbiting an ammonia world; an ELW; on/orbiting a body with geologicals or organics | — |
| Industrial & Refinery | system has major/pristine resources | system has low/depleted resources |
| Tourism | ammonia world; system has a black hole; ELW; geologicals; organics; water world; system has a white dwarf or neutron star | — |

Worked example from the source (reproduced as `links.test.ts`'s boost/decrease test): on a volcanic
body, an Extraction facility's strong link to the port is boosted; an Agriculture facility's strong
link on the same body is not.

**Colony economy override table** — stacking, based on the body a port is on/around (every port
defaults to "Colony" otherwise):
| Body attribute | Adds economies |
|---|---|
| Black hole, neutron star, or white dwarf | HighTech, Tourism |
| Brown dwarf or any other star type | Military |
| Earth-like world | Agriculture, HighTech, Military, Tourism |
| Water world | Agriculture, Tourism |
| Ammonia world | HighTech, Tourism |
| Gas giant | HighTech, Industrial |
| High metal content / metal rich world | Extraction |
| Rocky ice | Industrial, Refinery |
| Rocky | Refinery |
| Icy | Industrial |
| Has rings (incl. stars with asteroid belts) | Extraction |
| Has organics | Agriculture, Terraforming |
| Has geologicals | Extraction, Industrial |

**Population growth**: population grows significantly faster with a significantly higher cap;
overall capacity is still determined by which port/facility types are built; growth happens on
weekly maintenance ticks along a curve that's fast for the first month, then slows. Not otherwise
modeled here (no population-growth simulation in this codebase).

**Station service activation rules**, condensed. *Not currently implemented in code* — left here as
reference in case this gap is worth closing later:
- **Commodities Market**: all T2/T3 ports; all Settlements; Commercial/Industrial/Civilian Outposts
  + (strong link to a Comms Installation or Relay Station, OR a Tourist/Bar Installation or Outpost
  Hub anywhere in the system); Criminal/Scientific/Military Outposts + a strong link to any of
  Comms/Relay/Tourist/Bar/Outpost Hub (strong link required for all five, unlike the civilian group).
- **Shipyard** (always needs system tech level ≥ 35 — instantly granted by building a T2/T3 port):
  T2/T3 port; or a Tier 1 Planetary Port + (strong link to Comms/Relay, OR Tourist/Bar/Outpost Hub
  in system); or a strong link to a High Tech Hub, Military Installation, or Industrial Hub.
- **Outfitting** (same tech-level gate): T2/T3 port; Military Outpost; Tier 1 Industrial Planetary
  Port; any other T1 Outpost or non-Industrial T1 Planetary Port + (strong link to an Industrial
  Hub, OR a Military Installation/High Tech Hub in system).
- **Universal Cartographics**: T3 port; Scientific Outpost; T1/T2 port + (strong link to a
  Satellite/Comms/Relay, OR a Scientific Installation/Exploration Hub in system); Research Bio
  Settlements (not a port — out of this app's ports-only scope regardless).
- **Vista Genomics**: T3 port; a Tier 1 Planetary Port or T2 port + (strong link to a
  Satellite/Comms/Relay, OR a Medical Installation/Scientific Hub in system).
- **Black Market**: Pirate Outpost (no exact building-name match — would map to `Criminal_Outpost`);
  any port + a strong link to a Pirate Installation.
- **Crew Lounge**: T2/T3 port; Criminal or Civilian Outposts; Tier 1 Civilian Planetary Ports; any
  other T1 port + a Bar Installation built anywhere in the system.
- **Pioneer Supplies**: every port, unconditionally (T1/T2/T3, all Outposts, T1 Planetary Port).
- Station interiors additionally change weekly based on the highest-proportion economy present —
  not modeled (no commodity-proportion simulation, per the scope boundary above).

**Demolition/cancellation mechanics**: constructions and completed facilities can be marked for
demolition, removed at the next weekly maintenance (cancelable before then); the primary/initial
port can't be demolished; slots and construction points are refunded on demolition; a facility must
be demolished before the prerequisite it depends on (unless another instance of that prerequisite
remains); missions at a demolished facility are deleted; commodities already put into a cancelled
construction effort are lost. Only a narrow slice of this is incorporated (see "Deliberate scope
boundaries" above): a demolishable already-present facility's slot/stat/T2-T3 refund, computed
instantly as part of the solve rather than modeled as a weekly-tick event. No mission tracking, no
partial/in-progress construction, and the primary station and the 5 escalating-cost-curve port
buildings are never demolishable.

**Dodec Update score-weighting** — implemented as `FIRST_STATION_BONUS`/
`SUBSEQUENT_FACILITY_REDUCTION` in `data/buildings.ts` (a general game rule, not solver-LP-specific,
so `domain/currentSystemScores.ts` can reuse the same constants for its plain-number reweight):
first station +40%/+40%/+40%/+20%/+40% (development level/security/standard of living/tech
level/wealth); subsequent facilities −10%/−10%/−20%/−25%/−25% (same five, same order).

### Design notes

**The solver's objective DOES take link/economy into account, via `economy_synergy`.** See
`solve.ts`'s header comment (search `economy_synergy`) for the exact mechanism: each candidate
(building, body) pair gets a coefficient from `domain/economyOverrides.ts`'s existing verbatim
strong-link boost/decrease table (`computeBoostDecrease`), applied to that building's own economy
type(s) (`facilityBaseEconomies`) as if a strong link to it had already formed — regardless of
whether one actually would in the final solved layout. This is deliberately NOT an attempt to embed
the full strong/weak-link *graph* (which body's port is dominant, etc.) inside the MILP — that
depends circularly on the very placement decisions being solved for. `economy_synergy` is exposed as
an ordinary `Score` (letter `y` in custom objective expressions) — see `ObjectivePanel`'s default
expression, which includes it. Body placement (`SolverInput.bodies`) still *also* enters the MILP
purely as a *feasibility* constraint (real per-body slot capacity, replacing the old 3 aggregate
slot pools when present) and still separately feeds `domain/links.ts`'s post-solve computation for
the "i" info icons' exact link topology — `economy_synergy` is additive to both of those existing
roles, not a replacement for either.

**Backward compatibility is load-bearing, not incidental.** `SolverInput.bodies` absent/empty (the
default — anyone using only the System facilities panel's aggregate slot fields) reproduces today's
exact solver behavior; `PlannerFormState.bodies` empty is the same signal at the state layer. This
is covered by an explicit regression test in `solve.test.ts` (`bodies: []` vs. omitted must be
byte-identical) — don't remove it if you touch `solve.ts`'s per-body code paths. `SolverBody.economy`
(feeding `economy_synergy` above) is its own nested opt-in on top of that: a body present but with
`economy` omitted contributes 0 to `economy_synergy` rather than erroring, same degrade-gracefully
pattern.

**Port placement fidelity is deliberately approximate, not exact**, for the rare case of two
*different* port types tied in tier landing on the same body: `solve.ts` doesn't thread body
assignment through the `port_k` build-sequence index (which would require a `5 building types × 20
slots × N bodies` variable blow-up with heavy MILP symmetry); `domain/links.ts`'s tie-break instead
uses the solved `portOrder` as an approximate signal. This never affects what the solver recommends
building — only a display-only tie-break in the "i" info icons' link/economy display.

**`getPortTier()` reuses existing `T2points`/`T3points === "port"` fields**, matching the official
"Tier 1/2/3 Port" vocabulary — but that source's tier language is actually about a specific port
*instance's* own upgrade investment (has this specific port had T2/T3 points spent on it yet), which
this app's solver doesn't track at all (only aggregate points system-wide): treating every instance
of a tier-2/3-capable building type as already at its ceiling is an optimistic approximation.

**`SolverResult.placements` is new-builds-only — feeding it alone to `computeSystemLinks` silently
drops every already-present facility's link contribution.** `solve.ts` folds already-present
facilities into the MILP as plain constants, never as their own `bodyVars` decision-variable entry,
so they never appear in `placements` at all. `SolvedSystemPanel.tsx` uses
`domain/solvedLinks.ts`'s `computeSolvedSystemLinks`, which merges `result.placements` with the same
present-facilities conversion `presentLinks.ts` uses (excluding whatever `result.demolished`
actually removed) before calling `computeSystemLinks`. If you add a new caller of a solved plan's
link topology, use `computeSolvedSystemLinks`, not `computeSystemLinks(bodies, result.placements,
...)` directly.

### Per-facility economy ratio accumulation (System facilities panel hover — user-supplied, not verbatim source text)

The System facilities panel's per-facility hover ("i" icon on a built slot) shows an "Economy
ratios" block (per economy: total, then a body/strong-link/weak-link breakdown) and a "Market
links" block (a 3-column Economy/Strong link/Weak link table of *counts*, not percentages) — this
is entirely user-supplied real-game-testing rules, not from any official patch note text (which
only ever says links "supply a proportion" of an economy, never a number). Implemented in
`domain/links.ts`'s `computeSystemLinks` (`PortEconomyLine`/`MarketLinkLine`), consumed by
`facilityEconomyRatios`/`facilityMarketLinks` in `components/FacilityInfo.tsx` — shared by both
"Actual facilities" (fed `domain/presentLinks.ts`'s present-only `SystemLinksResult`) and "Solved
system" (fed `domain/solvedLinks.ts`'s solved one). Rules:

- **Strong-link contribution** = `LINK_TIER_CONTRIBUTION_RATE[giver's tier]` (0.4/0.8/1.2 for
  Tier 1/2/3) `+` that economy's own strong-link boost/decrease delta on the shared body —
  regardless of what percentage the economy shows on the giving facility itself. Confirmed against
  a real example: a Military Settlement's own Military value is 100%, but it only contributes 40%
  to a linked port. "Tier" here is `getLinkContributionTier()` (`data/buildings.ts`) — a *different*
  computation from `getPortTier()`'s official Tier 1/2/3 Port vocabulary, derived from whether a
  building grants a flat T2 point (Tier 1), a flat T3 point (Tier 2, "flat" meaning non-escalating —
  Coriolis/Asteroid_Base land here despite being "T2 ports" under `getPortTier()`, a coincidence of
  two unrelated computations), or neither (Tier 3 — only Orbis_or_Ocellus/Dodecahedron/
  Planetary_Port, whose own escalation currency IS T3 itself).
- **Weak-link contribution** = a flat `WEAK_LINK_CONTRIBUTION` (5%, no tier-scaling, no
  boost/decrease — consistent with the official "weak links are unaffected by that mechanic" rule),
  from every strong-link giver system-wide to every OTHER body's representative port. "System-wide"
  is literal: a facility on a body with no port at all still weak-links elsewhere even though it
  can't strong-link locally.
- **The ground->space forwarding hop is excluded from being its own additional weak-link giver**
  (`addStrongLink`'s `skipWeakGiver` option) — the ground-dominant port forwarding its
  already-locally-strong-linked economies onward to the space-dominant port must not ALSO
  separately broadcast them as a weak link, since that economy already reached the system through
  its own original sources. A same-side non-dominant port (e.g. a tier-2 Coriolis losing dominance
  to a tier-3 Orbis on the same body) is NOT excluded this way — it still counts as its own
  independent weak-link giver.
- The "Market links" table's counts are the number of contributing *building instances*, not a
  weighted amount, summed per economy, with zero rendered as "-" in the UI.

All of the above is validated end-to-end in `links.test.ts` against the exact numbers from a real
exported system (`jsons/swoilz-aw-c-d52.json`) rather than just theoretical worked examples.

## Workflow constraints

- **Prefer real structural fixes over suppress.** Only suppress a warning when there's genuinely
  no non-deprecated/non-unsafe alternative — and call that out explicitly rather than suppressing
  silently.
- **Summarize the plan in a good PR title and description.** Don't assume reviewers will read the
  code diff to understand the intent. Summarize the change in a few sentences and call out any known
  limitations or follow-up work.
- **Maintain the current PR tasks in TASKS.md** — don't assume it's up to date, but keep it up to
  date when you make changes. Mark a task done rather than deleting it silently until the user asks
  to clear finished work; remind the user to check TASKS.md at the start of new PR work.
- **Skip embedded browser test runs during iteration** — run them at the end of a session, not after
  every small edit or plan fine-tuning.
- **Same treatment for `App.test.tsx`**: its worker-start flakiness (see "Testing conventions" above)
  slows down the flow if run after every small edit. A `tsc -b` pass plus the narrower test file(s)
  actually touched by the change is enough signal in the moment — run the full file once, near the
  end of the session, and just retry on the documented worker-timeout flake rather than treating it
  as a regression to investigate.
- **Comments for the actual code**: in the comments primarily explain the code actual state,
  avoid historical comments ("this was before", "that is because it was", etc).

