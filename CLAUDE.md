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
  data/buildings.ts       — the 54 buildings: stats, costs, T2/T3 points, dependencies, Update 3
                            Port/Facility role + tier + best-effort economy-type classification
  domain/
    systemState.ts        — SystemState: tracks running points/scores/slots as buildings are added
    ordering.ts            — computes a feasible build order (dependency/point-respecting sequence)
    economyOverrides.ts    — Update 3 body-attribute -> economy-type override/boost/decrease tables
    links.ts                — Update 3 Strong/Weak link topology, computed post-solve from placements
    stationServices.ts      — Update 3 station-service (Shipyard/Outfitting/etc.) unlock rules
    populationEstimate.ts   — illustrative-only population growth curve (no official formula exists)
    presentFacilities.ts    — already-built-facility hard/demolishable split + T2/T3 seed derivation
                              for the System facilities panel (see "Update 3 link/economy modeling")
    bodyHierarchy.ts        — reconstructs the star/planet/moon/sub-moon nesting from body-naming
                              convention, for the System facilities tree's display only (UI-only,
                              not consumed by the solver or any other domain module)
  solver/
    expressionParser.ts    — safe recursive-descent parser for custom objective expressions
    objective.ts            — compiles parsed expressions into an LP-linearizable form
    lpExpr.ts / lpModel.ts — linear-expression algebra + LP-format model builder
    solve.ts                — the actual MILP: builds the model, calls HiGHS, parses the solution;
                              optionally per-body (see "Per-body placement" below)
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

## Explicitly unverified/best-effort constants — don't "fix" these without new evidence

Deliberately isolated as named constants, flagged in code comments and in the UI, so they're easy
to correct once better data shows up — treat them as placeholders, not as settled facts. Two are
genuinely unverified (no official source found); the rest are official-source-*derived* but require
an inference this project made itself, not something the source stated verbatim — also flagged,
also revisable:

- `GROUND_SLOT_RADIUS_THRESHOLDS` (and the rest of the heuristic) in `src/journal/eligibility.ts` —
  how scanned body data maps to buildable slot counts. The ground-slot half is now sourced from
  community research (CMDR Nyatto, Flynnvali, and others — see also the Raven Colonial tool for the
  most current version); the orbital-slot half still has no known per-body formula. Still pre-filled
  into editable UI fields (with a "Reset slots to guess" button to reapply it), never locked in.
- `FACILITY_ECONOMY_GUESS` in `src/data/buildings.ts` — maps Hub/Settlement/Installation buildings
  to Update 3 economy types. The official body-attribute override table is verbatim-sourced (see
  below), but no official per-building economy mapping was ever published; several buildings are
  deliberately left unmapped rather than guessed (see the comment above the constant).
- `PORT_FIXED_ECONOMY` in `src/data/buildings.ts` — the subset of `PORT_ROLE_BUILDINGS` with a
  fixed, non-"Colony" economy instead of the body-attribute-override behavior every other port gets
  (e.g. a Military Outpost is always 100% Military regardless of the body). Mostly *not* a guess —
  sourced verbatim from `DaftMav-v3.4.1.ods`'s "Stats" tab, "Facility Economy" column, and
  user-confirmed in-game for the two entries the sheet doesn't cover cleanly:
  `Civilian_Outpost`/`Commercial_Outpost` (space) and `Civilian_Planetary_Outpost` (ground) are
  deliberately left OUT of this table (they take the body-derived economy like generic ports,
  confirmed in-game — an earlier version of this table wrongly hardcoded them to fixed Colony 100%,
  which was the original bug report that started this). Known gap: `Criminal_Outpost`'s sheet
  economy is "Contraband," not one of this app's 9 `EconomyType` values at all (not in any of the
  officially-sourced Update 3 tables either) — left out of this table for lack of anywhere to put
  it, falling through to the Colony-default approximation instead of a confirmed value.
- `populationEstimate.ts`'s growth curve — genuinely invented, not derived from anything. No
  official population-growth formula has ever been published; this is a shaped curve chosen only to
  match the patch notes' qualitative "fast then slowing" description. Never treat its numbers as
  real, and the UI carries a permanent disclaimer for the same reason.
- ~~`SUBSEQUENT_FACILITY_WEIGHT`~~ — **no longer unverified.** Now `FIRST_STATION_BONUS`/
  `SUBSEQUENT_FACILITY_REDUCTION` in `src/solver/solve.ts`, sourced from the Dodec Update patch
  notes (2025-11-11) with official exact percentages. Left here as a historical note: this is
  exactly the kind of correction this section exists to enable — if you find a similarly-official
  source for one of the entries still above, replace the guess and move the entry here too.
- `BOOST_DECREASE_DELTA`/`ECONOMY_RATIO_FLOOR_PERCENT` in `src/domain/economyOverrides.ts` (the
  System facilities panel's per-facility "Economy ratios" hover) — the ±40-percentage-point-per-
  condition and 10% floor magnitudes are community-sourced (`EconomicEffects.ods`'s "Lookups -
  Innates and Modifiers" sheet), not an official Frontier-published number; the official patch notes
  only say boosts/decreases exist, never by how much. Cross-validated against several real reported
  in-game values (Agriculture 140%/100% with/without organics, Extraction/Industrial 140% from
  system resources) before landing, but still the kind of number this section exists to flag.
- `TERRAFORMABLE_AGRICULTURE_BUG_NOTE` in `src/domain/economyOverrides.ts` — the official patch
  notes and `EconomicEffects.ods` both list a Terraformable body as an Agriculture strong-link boost
  condition (+0.40, same table as the entry above), but real-game testing (user-confirmed) found it
  has no observable effect on Agriculture's actual value, suspected to be a Frontier bug rather than
  a documentation error. Deliberately excluded from every boost/decrease computation in that file
  (`computeBoostDecrease`, `computeColonyEconomyBreakdown`, `computeStrongLinkBreakdown`) so displayed
  values match observed game behavior, not the patch notes; surfaced instead as a short one-line
  disclaimer next to the body-info hover's economy tables in `SystemConfigPanel.tsx`, linking to a
  full explanation on the new `public/known-issues.html` page (`TERRAFORMABLE_AGRICULTURE_BUG_LINK`)
  rather than spelling it out inline — the hover bubble is `white-space: nowrap` (`Tooltip.css`), so
  a long inline sentence used to force it absurdly wide instead of wrapping; `Tooltip.css` now also
  opts tooltip-content links back into `pointer-events` individually so that link is actually
  clickable (the bubble itself stays click-through). `known-issues.html` is a static page (not part
  of the React app/build), meant as a general "current known issues" page — add future entries there
  too, not just more inline hover disclaimers. Revert by re-adding the `isTerraformable(body)` boost
  call at each of the three sites (search the constant's usages) if Frontier ever fixes this in-game.
- `LINK_TIER_CONTRIBUTION_RATE` (0.4/0.8/1.2) and `WEAK_LINK_CONTRIBUTION` (flat 0.05) in
  `src/domain/links.ts` — how much of a linked economy a facility/port contributes *to a linked
  port* through a strong or weak link respectively (distinct from `BOOST_DECREASE_DELTA` above,
  which is about a facility's *own* displayed ratio). The tier-scaled strong-link number is
  community-sourced (`EconomicEffects.ods`'s "Strong Link Modifiers" sheet); the flat weak-link 5%
  is a user-supplied rule with no official-source equivalent at all (the patch notes only say weak
  links exist, never a number). Both cross-validated against a real in-game system's exact reported
  percentages/counts (see `links.test.ts`'s two dedicated regression tests) rather than just
  theoretical — but still flagged the same way as everything else in this section.

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
- **`SolverBody.slots` is a body's TOTAL physical slot count, not "remaining capacity."** An earlier
  version of this doc comment said "remaining" (the caller was expected to manually pre-subtract
  already-built stuff); `solve.ts` now computes remaining capacity itself from each body's
  `presentFacilities`. If you're reading old comments/PRs that say "remaining," that's stale.
- **Already-present ports have no recorded real build order**, but the escalating T2/T3 port cost
  curve (`getT2PortCost`/`getT3PortCost`) is order-dependent — `domain/presentFacilities.ts`'s
  `computePresentPortsSeed` picks a deterministic stand-in order (by body, space before ground, then
  slot index) to charge their historical cost into the T2/T3 starting balance. Same kind of
  approximation as `links.ts`'s "ties broken by build order" tie-break below — flagged, not a bug.

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
  slice of the 2025-09-29 patch's full demolition/cancellation mechanics (see below): no refund
  timing, no mission deletion, and the 5 escalating-cost-curve port buildings (`isPort()`) are
  never demolishable — unwinding the escalating T2/T3 cost curve's build-order dependence for a
  removable port wasn't worth the complexity, and settlements/hubs/installations are the actually
  useful case anyway.

## Update 3 link/economy modeling

Sourced from official Frontier patch notes across four updates: the original Update 3 link/economy
rework (2025-04-27), a station-service activation-rules follow-up (2025-06-04), the Type-11 update
(2025-09-29; reviewed, not incorporated — demolition mechanics, see above), and the Dodec Update
(2025-11-11; sourced the `FIRST_STATION_BONUS`/`SUBSEQUENT_FACILITY_REDUCTION` numbers). This is
the basis for `data/buildings.ts`'s `FACILITY_ECONOMY_GUESS`/`PORT_ROLE_BUILDINGS`/`getPortTier`
and all of `domain/economyOverrides.ts`, `domain/links.ts`, `domain/stationServices.ts`.

### Verbatim rules (implementation should match these exactly)

**Ports vs Supporting Facilities** (2025-04-27): Ports = Outposts, Coriolis/Orbis/Ocellus Stations,
Asteroid Bases, Planetary Ports, Planetary Port Outposts. Supporting Facilities = Settlements,
Installations, Hubs.

**Strong vs Weak links** (2025-04-27): Strong links form between a port and any facility on/around
the same body, and between multiple ports on the same body (highest tier wins; ties broken by build
order, earlier wins). If a body has both a planetary and a space-based port: planetary facilities
strong-link to the planetary port, which passes those links onward to the orbital port (same
tier/order priority). Weak links form between ports and facilities on *different* bodies in the
same system. Both link types can coexist (one facility can supply several ports). Links only ever
form port↔facility or port↔port — never facility↔facility. A port can carry multiple economy types
at once; each additional type via a link proportionally introduces trade in that type.

**Strong-link boost/decrease table** (2025-04-27) — only strong links are affected, weak links
never are:
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

**Colony economy override table** (2025-04-27) — stacking, based on the body a port is on/around
(every port defaults to "Colony" otherwise):
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

**Population growth** (2025-04-27): population now grows significantly faster with a significantly
higher cap; overall capacity is still determined by which port/facility types are built; growth
happens on weekly maintenance ticks along a curve that's fast for the first month, then slows.

**Station service activation rules** (2025-06-04), condensed:
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
  Settlements (not a port — out of this app's ports-only scope, see `stationServices.ts`).
- **Vista Genomics**: T3 port; a Tier 1 Planetary Port or T2 port + (strong link to a
  Satellite/Comms/Relay, OR a Medical Installation/Scientific Hub in system).
- **Black Market**: Pirate Outpost (no exact building-name match — mapped to `Criminal_Outpost`,
  see `stationServices.ts`'s header caveat); any port + a strong link to a Pirate Installation.
- **Crew Lounge**: T2/T3 port; Criminal or Civilian Outposts; Tier 1 Civilian Planetary Ports; any
  other T1 port + a Bar Installation built anywhere in the system.
- **Pioneer Supplies**: every port, unconditionally (T1/T2/T3, all Outposts, T1 Planetary Port).
- Station interiors additionally change weekly based on the highest-proportion economy present —
  not modeled (no commodity-proportion simulation, per the scope boundary above).

**Demolition/cancellation mechanics** (2025-09-29): constructions and completed facilities can be
marked for demolition, removed at the next weekly maintenance (cancelable before then); the
primary/initial port can't be demolished; slots and construction points are refunded on demolition;
a facility must be demolished before the prerequisite it depends on (unless another instance of
that prerequisite remains); missions at a demolished facility are deleted; commodities already put
into a cancelled construction effort are lost. Only a narrow slice of this is incorporated (see
"Deliberate scope boundaries" above): a demolishable already-present facility's slot/stat/T2-T3
refund, computed instantly as part of the solve rather than modeled as a weekly-tick event. No
mission tracking, no partial/in-progress construction, and the primary station and the 5
escalating-cost-curve port buildings are never demolishable — this project still does no general
construction-progress tracking.

**Dodec Update score-weighting** (2025-11-11) — already implemented as `FIRST_STATION_BONUS`/
`SUBSEQUENT_FACILITY_REDUCTION` in `solve.ts`, repeated here for completeness: first station
+40%/+40%/+40%/+20%/+40% (development level/security/standard of living/tech level/wealth);
subsequent facilities −10%/−10%/−20%/−25%/−25% (same five, same order).

### Design notes

**The solver's objective/scores are untouched by this feature.** Links govern commodity
supply/demand — a mechanic this tool has never modeled — so there's no existing score for link
topology to feed into, and none was invented. Body placement (`SolverInput.bodies`) enters the MILP
purely as a *feasibility* constraint (real per-body slot capacity, replacing the old 3 aggregate
slot pools when present) and as a *deterministic input* to `domain/links.ts`'s post-solve
computation — mirroring how `domain/ordering.ts` already computes build order after `solve()`
returns without being part of the MILP itself.

**Backward compatibility is load-bearing, not incidental.** `SolverInput.bodies` absent/empty (the
default — anyone using only the System facilities panel's aggregate slot fields) reproduces today's exact
solver behavior; `PlannerFormState.bodies` empty is the same signal at the state layer. This is
covered by an explicit regression test in `solve.test.ts` (`bodies: []` vs. omitted must be
byte-identical) — don't remove it if you touch `solve.ts`'s per-body code paths.

**Port placement fidelity is deliberately approximate, not exact**, for the rare case of two
*different* port types tied in tier landing on the same body: `solve.ts` doesn't thread body
assignment through the `port_k` build-sequence index (which would require a `5 building types × 20
slots × N bodies` variable blow-up with heavy MILP symmetry); `domain/links.ts`'s tie-break instead
uses the solved `portOrder` as an approximate signal. This never affects what the solver
recommends building — only a display-only tie-break in the Links panel.

**`getPortTier()` reuses existing `T2points`/`T3points === "port"` fields**, matching the official
"Tier 1/2/3 Port" vocabulary from the June 2025 patch — but that source's tier language is actually
about a specific port *instance's* own upgrade investment (has this specific port had T2/T3 points
spent on it yet), which this app's solver doesn't track at all (only aggregate points system-wide).
`stationServices.ts` documents this gap in its header: treating every instance of a tier-2/3-capable
building type as already at its ceiling is an optimistic approximation that can overstate service
availability for a freshly-built, not-yet-upgraded port.

### Per-facility economy ratio accumulation (System facilities panel hover — user-supplied, not verbatim source text)

The System facilities panel's per-facility hover ("i" icon on a built slot) shows an "Economy
ratios" block (per economy: total, then a body/strong-link/weak-link breakdown) and a "Market
links" block (a 3-column Economy/Strong link/Weak link table of *counts*, not percentages) — this
is entirely user-supplied real-game-testing rules, not from any official patch note text (which
only ever says links "supply a proportion" of an economy, never a number). Implemented in
`domain/links.ts`'s `computeSystemLinks` (`PortEconomyLine`/`MarketLinkLine`), consumed by
`SystemConfigPanel.tsx`'s `facilityEconomyRatios`/`facilityMarketLinks`. Rules, in order of
discovery/confirmation:

- **Strong-link contribution** = `LINK_TIER_CONTRIBUTION_RATE[giver's tier]` (0.4/0.8/1.2 for
  Tier 1/2/3) `+` that economy's own strong-link boost/decrease delta on the shared body —
  regardless of what percentage the economy shows on the giving facility itself. Confirmed against
  a real example: a Military Settlement's own Military value is 100%, but it only contributes 40%
  to a linked port. "Tier" here is `getLinkContributionTier()` (`data/buildings.ts`) — a *different*
  computation from `getPortTier()`'s official Tier 1/2/3 Port vocabulary, derived from whether a
  building grants a flat T2 point (Tier 1), a flat T3 point (Tier 2, "flat" meaning non-escalating —
  Coriolis/Asteroid_Base still land here despite being "T2 ports" under `getPortTier()`, since that
  data point is a coincidence of two unrelated computations), or neither (Tier 3 — only
  Orbis_or_Ocellus/Dodecahedron/Planetary_Port, whose own escalation currency IS T3 itself).
- **Weak-link contribution** = a flat `WEAK_LINK_CONTRIBUTION` (5%, no tier-scaling, no
  boost/decrease — consistent with the official "weak links are unaffected by that mechanic" rule),
  from every strong-link giver system-wide to every OTHER body's representative port. "System-wide"
  is literal: a facility on a body with no port at all still weak-links elsewhere even though it
  can't strong-link locally (nothing on its own body to strong-link to) — confirmed against a real
  system where 3 port-less bodies' Agricultural settlements were the system's *only* Agriculture
  source, and real play showed exactly as many Agriculture weak links as settlement instances.
- **The ground->space forwarding hop is excluded from being its own additional weak-link giver**
  (`addStrongLink`'s `skipWeakGiver` option) — the ground-dominant port forwarding its
  already-locally-strong-linked economies onward to the space-dominant port must not ALSO
  separately broadcast them as a weak link, since that economy already reached the system through
  its own original sources; double-counting it here was confirmed (via the same real system above)
  to overcount a Refinery weak-link total by exactly the redundant amount. A same-side non-dominant
  port (e.g. a tier-2 Coriolis losing dominance to a tier-3 Orbis on the same body) is NOT excluded
  this way — it still counts as its own independent weak-link giver.
- The "Market links" table's counts are the number of contributing *building instances*, not a
  weighted amount — i.e. the same `count` each `addStrongLink`/weak-giver entry already carries,
  summed per economy, with zero rendered as "-" in the UI.

All of the above is validated end-to-end in `links.test.ts` against the exact numbers from a real
exported system (`jsons/*.json` — the user's own save data, not committed) rather than just
theoretical worked examples.

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
- **Skip embedded browser test runs** - run the embedded browser tests in the end of the sessions,
  skip them in the conversations and fine tunings of the plan.