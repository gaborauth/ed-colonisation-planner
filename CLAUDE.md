# EDCP: Elite Dangerous Colonisation Planner

A stateless, client-only React web app that solves "what should I build in this colonisation
system?" via a MILP solver (HiGHS, compiled to WASM) running entirely in the browser. No backend, no
account — everything (solving, persistence) happens client-side. **One deliberate exception** (added
2026-07-26): the "Spansh" import tab depends on a small self-hosted CORS proxy (see `src/spansh/`
below) — Journal-file import remains fully backend-free either way.

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
    presentFacilities.ts    — already-built-facility hard/demolishable split + T2/T3 seed derivation
                              for the System facilities panel (see "Update 3 link/economy modeling")
    bodyHierarchy.ts        — reconstructs the star/planet/moon/sub-moon nesting from body-naming
                              convention, for the System facilities tree's display only (UI-only,
                              not consumed by the solver or any other domain module)
    solvedPlacement.ts       — turns a solved SolverResult back into a per-body/per-slot picture
                              (present/primary/new/demolished, each tagged with its build-order
                              number) for SolvedSystemPanel's read-only tree
    buildOrderTable.ts       — BuildOrderPanel's full per-row Built/Demolish/Planned ledger
                              (numbered, running T2/T3 total) — see the Gotchas section for why it
                              costs every row via ordering.ts/systemState.ts, never solve.ts's own
                              new-port MILP formula
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
                              optionally per-body (see "Per-body placement" below), including an
                              `economy_synergy` score term (see "Update 3 link/economy modeling")
  state/plannerState.ts    — the app's one useReducer (form state) living in App.tsx
  persistence/             — localStorage-backed: saved plans, saved journal systems
  journal/                 — parses uploaded Elite Dangerous Journal files, estimates buildable slots
  spansh/                  — alternative system-import source (see "Spansh import" below):
                              api.ts (fetch wrappers against a self-hosted CORS proxy),
                              adapter.ts (Spansh `/dump/{id64}` JSON -> this app's own
                              JournalSystem/JournalBody shape, so the rest of the app never knows
                              the difference), types.ts
  components/               — one component per UI panel, no component library; FacilityInfo.tsx
                              (the "i" info icons) and SystemScoresSummary.tsx (score/points/slots
                              readout) are shared between "Actual facilities" and "Solved system"
```

State management is a single `useReducer` in `App.tsx` — no Redux/Zustand/Context. There's no backend
and no server-side state (with the one exception noted above for Spansh import); "stateless" refers
to that, not to an absence of persistence (localStorage is used deliberately for saved plans and
saved journal systems).

## Spansh import

`JournalImportPanel.tsx`'s "Import system" panel (renamed from "Import from journal") now has two
tabs: "Journal file" (unchanged — upload a real Journal log) and "Spansh" (search Spansh's public
system database by name and load a starting point directly, no journal file needed — useful for a
system not yet personally scanned). Both tabs feed the exact same shared `systems` list, body/slot
table, and `dispatch`/`applySystem` flow — the only thing that differs is how a `JournalSystem`
enters that list in the first place (`parseJournalScans` for the Journal tab,
`spansh/adapter.ts`'s `spanshDumpToJournalSystem` for the Spansh tab).

**Why a proxy at all**: neither of Spansh's endpoints used here sends CORS headers (confirmed via
curl during investigation — no `Access-Control-Allow-Origin` on `/systems/field_values/name` or
`/dump/{id64}`, including the OPTIONS preflight), so a direct browser `fetch()` from this app's
origin is blocked. The user runs a small self-hosted nginx CORS proxy on their own K8s cluster
(`https://spansh-proxy.iotguru.dev`, not part of this repo) that forwards to `spansh.co.uk/api/...`
and allowlists this app's two real origins (`https://gaborauth.github.io`,
`http://172.18.24.144:5173` for local dev) via CORS. `src/spansh/api.ts` hardcodes that proxy's
public URL as `SPANSH_PROXY_BASE` — if the proxy ever moves, that's the one place to update.

**Two Spansh endpoints, two different jobs** — don't confuse them:
- `GET /systems/field_values/name?q=...` — the real typeahead/autocomplete endpoint used for the
  Spansh tab's search-as-you-type combobox. (`/search` is a *different* endpoint — full-text search
  returning complete system records, not name suggestions — not used anywhere in this app.)
- `GET /dump/{id64}` — full per-body data for the "Load" button, once a candidate is picked. This
  supersedes an earlier, much sparser `/system/{id64}` endpoint this feature briefly targeted before
  `/dump/{id64}` was found (see git history if curious) — dropped entirely, not used anywhere
  (its old sample fixture was never committed and no longer exists on disk — nothing to clean up).

**Field mapping** (`spansh/adapter.ts`'s `spanshDumpToJournalSystem`): `/dump/{id64}` turns out to be
a near-1:1 equivalent of real Journal Scan-event data per body — confirmed field-by-field: real small
Frontier `bodyId`s (not synthesized — the main star is `bodyId: 0`, matching what a real Journal
upload of the same system would report, so the two sources merge correctly via
`JournalImportPanel.tsx`'s existing `mergeBySystemAddress` if the user later uploads a real Journal
for a Spansh-seeded system), real `parents` chains (byte-identical shape to Journal's raw `Parents` —
`parseParents`, now exported from `journal/parser.ts`, is reused as-is), rings, reserve level,
landable, gravity (same "g" units), surface temperature (same Kelvin units), atmosphere, tidal-lock,
terraforming state, and bio/geo signals using the *exact same* `$SAA_SignalType_Biological;`/
`$SAA_SignalType_Geological;` key strings Journal's `FSSBodySignals` event uses (`SIGNAL_TYPE_*`
constants, also now exported from `journal/parser.ts` for this reuse). Two adjustments needed:
`radius` is in km in Spansh's data vs. meters in Journal's (`× 1000`), and a body can lack the
`signals` key entirely (genuinely never scanned by anyone in Spansh's database — confirmed against
the real fixture: 18 of 31 planets in `spansh-jsons/swoilz-aw-c-d52-dump.json` have no `signals` key
at all), which must map to `undefined` ("unknown", matching Journal's own convention for an
un-FSS'd body) rather than `false` ("confirmed absent") — the adapter is careful about this
distinction (see its own comment).

**Real bug found by the user, Spansh-import-only (2026-07-27)**: a star's own asteroid belts were
dropped entirely. Spansh's `/dump/{id64}` names a planet's rings `rings` but a star's own belts
`belts` (confirmed against `spansh-jsons/swoilz-cd-e-c1-1-dump.json` — the star has a `belts` array,
no `rings` key at all; ordinary planets in the same dump use `rings`); `adapter.ts` only read
`body.rings`, so the star's belts vanished entirely. Fixed: `toJournalBody` now reads
`body.rings ?? body.belts ?? []`. Confirmed NOT to affect Journal-file import — `journal/parser.ts`
already uses one uniform `Rings` key for both stars and planets.

**Second, deeper fix found investigating the above, STAR belts only** (2026-07-27, user-clarified
via a real in-game screenshot after the first version of this fix): a star's belt isn't extra
capacity on the star's own orbital slot(s) at all — it's its own separate, dedicated constructible
location, physically far from the star (visible as its own distinct point in the system map,
"Swoilz CD-E c1-1 A Belt Cluster 1 Slot 0"). `journal/parser.ts`'s new `withRingBodies` synthesizes
one extra `JournalBody` (`kind: "ring"`) per named belt on every scanned STAR only, appended after
the real bodies (applied by both `parseJournalScans` and `spansh/adapter.ts`'s
`spanshDumpToJournalSystem`) — so it shows up as its own row in `JournalImportPanel`'s table and its
own node in `domain/bodyHierarchy.ts`'s tree (special-cased there too — a ring's multi-token name
like "A Belt" attaches as one leaf directly under its real parent, not walked token-by-token like an
ordinary body). `eligibility.ts`'s `estimateBodySlots` gives a star's own slot `asteroid: 0`
unconditionally now (was `1` if ringed) and the new ring body `{space: 1, ground: 0, asteroid: 1}`.

**The belt's slot is an ordinary orbital slot that additionally qualifies for Asteroid_Base, NOT an
Asteroid_Base-exclusive slot** (user-corrected 2026-07-27, right after the first version of this fix
shipped: any kind of orbital facility can go there, same as any other ring-eligible body) — so
`solve.ts` needed NO changes at all for this part; the pre-existing
`Asteroid_Base <= 0 when slots.asteroid === 0` rule (unaffected by this fix) already covers it
correctly for both a star's belt body and a ringed planet's own slot alike, and a port built on the
belt body still correctly gets the "Has rings" Extraction economy override via the belt body's own
self-referencing `rings: [ring]` (see below) feeding `economyOverrides.ts`'s `hasRings()` — not that
this specifically matters for Asteroid_Base itself, whose economy is unconditionally fixed to
Extraction regardless of body (`data/buildings.ts`'s `PORT_FIXED_ECONOMY`), but it matters for any
OTHER port type someone chooses to build on the belt's slot instead.

**Deliberately star-only, not planets/moons** — a planet's or moon's own ring is different (user
explicitly clarified this after reviewing the first version of this fix, which had generalized to
every ringed body): it keeps making that planet's/moon's OWN orbital slot(s) asteroid-eligible
directly, unchanged from this app's original (pre-2026-07-27) behavior, since a planet's ring sits
at the planet rather than being its own separate far-away location. A ringed planet's own slot can
therefore still host either an ordinary building or an Asteroid_Base (the pre-existing
approximation, `eligibility.ts`'s own doc comment) — only a STAR's belt gets the new
dedicated-body-only-Asteroid_Base treatment.

The ring body's own `rings` field self-references its own ring (`rings: [ring]`), so
`economyOverrides.ts`'s `hasRings()` still fires for a port built there (an Asteroid_Base built in a
belt should still get the "Has rings" Extraction bonus) — the star's own `rings` field is left
untouched, so a port built directly on the star still gets that bonus too, independently.

**Best-effort, not exact** (flagged in the "Explicitly unverified/best-effort constants" section
above too): the real game can show multiple numbered "Cluster N" locations per named belt (visible
in the same screenshot), which Journal/Spansh scan data has no way to count — this models exactly
one slot per named belt, same as every other slot count in this app (editable in the UI, never
locked in).

**One caveat that's semantic, not a code gap**: Spansh's signal/genus data is crowdsourced (whoever
last scanned that body in Spansh's own database), not necessarily *this player's own* scan — usually
accurate, but "known" here means "known to Spansh," not "known to you in-game." Surfaced as a short
disclaimer in the Spansh tab's own help text, not hidden.

**Switching between saved systems from the sticky toolbar**: `JournalImportPanel.tsx`'s own
"System" dropdown only ever lives in its "Journal file" tab, so once the Spansh tab loads a system
there was no way to switch back to a different already-saved one without folding back to that
specific tab. Fixed in `SystemPortabilityBar.tsx`: the plain `formState.starSystem` text next to
"Live Demo" becomes a real `<select>` (`.toolbar-summary-system`, styled to look the same as the
plain text it replaces) once more than one system is saved (`persistence/journalSystems.ts`'s
`listSavedSystems()`, read fresh every render rather than cached — cheap, synchronous, and avoids
needing a refresh-token scheme like `JournalImportPanel`'s own). Switching there re-dispatches the
picked system's already-saved data directly (no separate "Apply" step, unlike a freshly-parsed-but-
not-yet-reviewed Journal/Spansh load) — same `{type:"patch", patch:{...}}` shape as
`loadParsedSystem`, minus re-saving (already in the store) and `onImported` (nothing new imported).

**Real bug found by the user right after this shipped, in two parts**: reloading the page made the
whole toolbar summary — switcher included — disappear, only coming back after loading and re-saving
a system. Root cause: the summary (and the switcher inside it) was gated entirely on
`canSaveOrExport` (`formState.systemAddress !== null`), which resets to `null` on every fresh page
load — `JournalImportPanel.tsx`'s own mount-effect only auto-restored the last-used system when that
system already had a primary station saved, so a system applied but not yet given a saved primary
station left `formState` blank after reload, hiding the switcher that was supposed to be the way
BACK into that state.

- **First fix**: decoupled the switcher's visibility from `canSaveOrExport` entirely — it now
  renders (with a disabled placeholder option, nothing "selected") whenever
  `listSavedSystems().length > 0`, regardless of whether a system is currently active in
  `formState`; picking one dispatches the full saved system. The slot-bar/T2/T3-points half of the
  summary stays gated on `canSaveOrExport` (meaningless with no active system). Deliberately did NOT
  relax `JournalImportPanel`'s mount-effect condition at this point — treated as a separate,
  pre-existing design choice outside the scope of "the dropdown is gone."
- **Second fix, once the user noticed the deeper inconsistency this first fix left behind**: after
  reload, the toolbar switcher now correctly showed "Pick a saved system…" — but
  `JournalImportPanel`'s own panel simultaneously showed that same last-used system fully filled in
  (its own `systems`/`selectedAddress` state already defaults to the last-used system regardless of
  primary-station status, independent of `formState`) — two parts of the UI visibly disagreeing
  about whether a system was active. The real fix was to stop treating "no saved primary station
  yet" as a reason to skip auto-restoring at all: `JournalImportPanel`'s mount-effect now auto-
  applies the last-used system whenever it merely has bodies, dropping the primary-station
  requirement entirely (see that effect's own comment for why this is safe — not having a primary
  station yet is a normal, valid intermediate state elsewhere in the app too, e.g. right after a
  brand-new system's first-ever Apply; only actually solving requires one). This makes every part of
  the UI agree again after a reload, and the first fix above is kept anyway as a safety net for
  whenever `getLastUsedSystemAddress()` itself is unset despite systems being saved.

**Real bug found by the existing test suite while building this**: `App.test.tsx` (run in isolation,
not as part of the full `npm test`) started failing with `getByLabelText("Journal file")` throwing
"found multiple elements" — not a flake, a real ARIA-labeling collision introduced by the tab panels.
Each tab content `<div role="tabpanel">` was given `aria-labelledby` pointing at its own tab
button — the standard ARIA APG tabs pattern — but the "Journal file" tab button's text is the exact
same string as the Journal tab's file `<input aria-label="Journal file">` inside it.
`getByLabelText` isn't restricted to form controls: it also matches any element whose accessible
name (via `aria-label`/`aria-labelledby`) equals the target text, so it matched both the real input
AND the tabpanel div wrapping it. Fixed by giving each tabpanel its own distinct `aria-label`
("Journal file import"/"Spansh import") instead of borrowing the visible tab label text via
`aria-labelledby` — worth remembering if this app's ARIA wiring is extended further: don't reuse a
visible control's exact label text as another element's accessible name in the same subtree, this
test suite's query style isn't scoped strictly to form controls.

**Deliberately deferred, not attempted**: auto-detecting already-built facilities from Spansh's
per-body `stations[]` list (the dump has real per-body station placement, not just a flat
system-wide list). This would solve the "which body" half of present-facility auto-detection, but
Spansh's station `type` string still can't disambiguate which of this app's ~6-18 sub-variants of
Outpost/Settlement/Hub a given station actually is — left as a possible follow-up, not guessed at.

**Deliberately minimal `raw`**: unlike the Journal parser (which keeps the whole raw `Scan` event
in `JournalBody.raw`, a few hundred bytes each), `spanshDumpToJournalSystem` does NOT persist the
whole Spansh dump body object — a Spansh dump body carries a lot more incidental data (commodity/
market info, faction influence, composition percentages) that would needlessly bloat every saved/
exported system (user's explicit instruction). `raw` here only ever carries the one field anything
in the codebase actually reads out of it (`economyOverrides.ts`'s `hasVolcanism` reads
`raw.Volcanism`) — everything else Spansh provides but isn't mapped into `JournalBody`'s own typed
fields is simply not carried into the planner's data model at all, not just hidden in an unused bag.

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
`.github/workflows/release.yml`), driven by Conventional Commits (`feat:`, `fix:`, `chore:`, etc. —
already this repo's commit convention pre-dating this setup) via the `conventionalcommits` preset.

- **Push to `main`**: a real release — computes the next semver bump from commit history,
  regenerates `CHANGELOG.md`, bumps `package.json`'s `version`, commits both back
  (`chore(release): x.y.z [skip ci]`), tags, and publishes a GitHub Release with generated notes.
  `npmPublish` is disabled (`@semantic-release/npm` only bumps the local `version` field — this
  package is `private` and never goes to the npm registry).
- **Push to `development`**: dry-run only (`npx semantic-release --dry-run`) — logs what version
  *would* be released and validates commit messages, but never tags, commits, or publishes anything.
  Configured in `.releaserc.json` as a `prerelease` branch so the dry-run's simulated version
  (`x.y.z-development.N`) is meaningful, but the workflow only ever invokes `--dry-run` on this
  branch, so that prerelease config is never actually exercised for a real publish.
- First release (no prior tag) lands as `v1.0.0` — semantic-release's own default for an
  unreleased repo, regardless of the first-release commits' types.

**Known open risk, not yet verified**: `main` is branch-protected (PRs required to merge into it —
see `TASKS.md`'s recurring "branch-protected `main`" notes). The `@semantic-release/git` step needs
to push a commit directly to `main` after a merge lands; if branch protection rejects a direct push
from the default `GITHUB_TOKEN` (a very likely outcome — the pushing identity is the
`github-actions[bot]` app, which typically has no bypass even when the human owner is an admin with
"include administrators" unchecked), the release workflow's `Release` step will fail at the git-push
stage. The workflow reads `secrets.RELEASE_TOKEN` first, falling back to `secrets.GITHUB_TOKEN`, so
the fix (if this happens) is a fine-grained PAT belonging to an account with bypass rights, saved as
the `RELEASE_TOKEN` repo secret — or add a branch-protection bypass entry for `github-actions[bot]`
instead. Flagged here rather than silently assumed to work, since this can only actually be
confirmed by watching a real run in Actions (not reproducible in this sandboxed dev environment).

Dependency updates: Dependabot (`.github/dependabot.yml`) watches both `npm` and `github-actions`
ecosystems weekly, opening PRs against `development` (not `main` directly) with a `chore` commit
prefix — `chore:` doesn't trigger a semantic-release version bump on its own, keeping routine
dependency bumps out of the changelog unless a human recharacterizes one as a real `fix`/`feat`.

## Explicitly unverified/best-effort constants — don't "fix" these without new evidence

Deliberately isolated as named constants, flagged in code comments and in the UI, so they're easy
to correct once better data shows up — treat them as placeholders, not as settled facts. Two are
genuinely unverified (no official source found); the rest are official-source-*derived* but require
an inference this project made itself, not something the source stated verbatim — also flagged,
also revisable:

- `SPANSH_PLANET_CLASS_MAP` and the star-type classifier in `src/spansh/adapter.ts` — translates
  Spansh's `subType` wording to Journal's exact `PlanetClass`/`StarType` strings so
  `economyOverrides.ts`'s exact-match predicates (`isRockyIce`, `isWaterWorld`, `isAmmoniaWorld`,
  etc.) still fire correctly. Built from general Elite Dangerous domain knowledge covering every
  known planet class, but only actually verified against the classes present in the one committed
  real fixture (`spansh-jsons/swoilz-aw-c-d52-dump.json`) — e.g. the real, confirmed mismatch
  driving this table's existence: Spansh's `"Rocky Ice world"` must become `"Rocky ice body"` or
  `isRockyIce` silently never fires. Revise/extend this table if a differently-worded `subType`
  shows up in a future real system.
- `GROUND_SLOT_RADIUS_THRESHOLDS` (and the rest of the heuristic) in `src/journal/eligibility.ts` —
  how scanned body data maps to buildable slot counts. The ground-slot half is now sourced from
  community research (CMDR Nyatto, Flynnvali, and others — see also the Raven Colonial tool for the
  most current version); the orbital-slot half's own base count (flat 1 per star/planet) still has
  no known per-body formula — community reports describe it as scaling with overall system body
  count, but no formula was found. Still pre-filled into editable UI fields (with a "Reset slots to
  guess" button to reapply it), never locked in. Asteroid eligibility is now partially confirmed
  (2026-07-27, user-confirmed in-game, STAR belts only): a star's belt is its own separate,
  always-asteroid-eligible body (`kind: "ring"`, synthesized by `journal/parser.ts`'s
  `withRingBodies` — see the "Spansh import" section's "Second, deeper fix" note above for the full
  design), never the star's own slot; a ringed PLANET's own slot keeps the original, still-unconfirmed
  eligibility behavior unchanged (this app's pre-2026-07-27 default, deliberately not generalized to
  match the star case per explicit user scope correction). The real game can show multiple numbered
  "Cluster N" locations per named belt, uncountable from scan data — this models one slot per named
  belt, a best-effort floor like every other slot count here.
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
- ~~`populationEstimate.ts`'s growth curve~~ — **removed entirely** (2026-07-26, user request,
  along with the "Population growth (illustrative)" panel that was its only consumer — judged no
  longer useful). It was genuinely invented, not derived from anything (no official population-
  growth formula has ever been published; it was a shaped curve chosen only to match the patch
  notes' qualitative "fast then slowing" description) — kept here as a historical note per this
  section's own convention, not because anything still references it. See git history
  (`domain/populationEstimate.ts`) if reviving this.
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
- `economy_synergy` (`src/solver/solve.ts`'s `economySynergyCoefficient`, exposed as objective
  letter `y`) — a genuinely new approximation (not from a source table at all, unlike most entries
  above, which are at least community/official-*derived*): for a candidate (building, body) pair on
  a body already known (before solving) to have a port — a present one, or the primary station's
  assigned body — it applies the verbatim strong-link boost/decrease table (`computeBoostDecrease`)
  as if a strong link had already formed there. For any OTHER body, it deliberately does NOT apply
  that table — only a flat, body-attribute-independent `WEAK_LINK_CONTRIBUTION` (from
  `domain/links.ts`) per economy the building carries, since a body with no confirmed port can only
  ever weak-link elsewhere in the real mechanic, and weak links are unaffected by boost/decrease.
  This split was added after the first version (which applied the full boost everywhere) started
  actively steering the solver to dump facilities on port-less bodies purely to farm a boost that
  could never really apply there — visible as a spike in `domain/links.ts`'s "has N facility
  type(s) but no port" warnings once `economy_synergy` shipped (2026-07-25 user report). Still NOT
  the same thing as `domain/links.ts`'s real post-solve `computeSystemLinks` (which the "i" info
  icons throughout the app use unchanged, via `domain/solvedLinks.ts`, and which DOES know the true
  link graph once a layout is solved) — whether the
  solver will ALSO build a brand-new port on a currently-port-less body is itself a decision
  variable, so "known port" here means "known before solving," a conservative approximation in
  both directions, not exact. If a future change makes exact link-graph-aware MILP scoring
  tractable, replace this with that instead of layering more approximation on top.

## Gotchas worth knowing before touching the solver

- **The `highs` npm package's LP-text parser crashes (native WASM abort, not a graceful error) on
  `==` for equality constraints.** Use a single `=`. `lpModel.ts`'s `toLPFormat()` already translates
  this — don't reintroduce `==` if hand-editing LP-text generation.
- **`highs`'s WASM binary needs different loading strategies in Node vs. browser.** `solve.ts` checks
  for a real Node runtime (`globalThis.process.versions.node`) rather than `typeof window` — jsdom
  polyfills `window` but is still real Node underneath, so a `window` check picks the wrong branch
  under jsdom-environment component tests and breaks them.
- **`highs.solve(lpText, ...)` is a fully synchronous WASM call with no yielding — it blocks the JS
  main thread for the whole solve** (real user report 2026-07-27: the "Running the solver…" progress
  sweep visibly froze, since its CSS animation needs the main thread free to repaint). Fixed by
  running the actual solve in a Web Worker: `App.tsx` calls `solver/solveInWorker.ts`'s
  `solveInWorker()` instead of `solve()` directly, which posts the `SolverInput` to
  `solver/solveWorker.ts` (a separate worker entry point Vite bundles as its own chunk — confirmed via
  `npm run build`, no plugin needed) and resolves with the returned `SolverResult`.
  `solve.ts` itself is untouched — `App.tsx` is the ONLY production call site that actually invokes
  `solve()` (every other importer only uses its types), so no other code needed to change.
  `SolverInput`/`SolverResult` are plain structured-clone-safe data (no functions/class instances),
  so `postMessage` works with no adapter layer. `solveInWorker()` feature-detects `typeof Worker ===
  "undefined"` and falls back to calling `solve()` directly when there's no real `Worker` (jsdom,
  used by component tests including `App.test.tsx`, doesn't polyfill one) — this is a plain feature
  detect, unlike the Node-vs-browser check above, since jsdom doesn't fake `Worker` the way it fakes
  `window`. A fresh worker is created and terminated per call, matching `solve()`'s own existing
  behavior of loading a fresh HiGHS WASM instance on every call today — not a new cost, just
  relocated off the main thread. See `solveInWorker.test.ts` for the fallback path (real, exercised
  by every existing test indirectly) and mocked-`Worker` message-plumbing tests (the actual
  cross-thread path can't be exercised under jsdom — verified once via a real `npm run build` +
  manual browser check instead).
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
- **Tier-2-cost ports (Coriolis, Asteroid_Base) and Tier-3-cost ports (Orbis_or_Ocellus,
  Dodecahedron, Planetary_Port) escalate along INDEPENDENT sequences** — real-game-confirmed (see
  `computePresentPortsSeed`'s doc comment above). `domain/systemState.ts`'s `constructionPoints`
  had a real bug here (fixed 2026-07-26, found via a real exported system with both port tiers
  already present): it used one shared `this.ports.length` counter for both tiers, over-escalating
  whichever tier's port got built after a port of the OTHER tier — inflated enough that
  `ordering.ts`'s `computeFeasibleOrder` (used by `BuildOrderPanel`/`SolvedSystemPanel`) could throw
  "Could not finish ordering" for a plan `solve.ts` had already confirmed was T2/T3-feasible. Now
  fixed to count same-tier predecessors only (`systemState.test.ts`'s dedicated regression test).
  **`solve.ts`'s own new-port MILP cost model still has the same shared-index shape** (its
  `t2PortSlotSum`/`t3PortSlotSum` loop scales by `getT2PortCost(k)`/`getT3PortCost(k)` using ONE
  global sequential slot `k` shared across all 5 escalating port types, not a per-tier index) — left
  unfixed for now since, unlike the `systemState.ts` bug, this direction is *safe* (the shared global
  index is always >= the true same-tier count, and both cost curves are monotonically increasing, so
  it only ever OVER-estimates cost — conservative/suboptimal, never accepts a plan that's actually
  infeasible in-game). Revisit if a solved plan's port cost ever looks implausibly high with a mixed
  already-present port-tier set; fixing it properly means giving Tier-2-cost and Tier-3-cost ports
  their own separate sequential slot-index sequences instead of one shared `port_k`-style index
  across all 5 types — a bigger MILP restructuring than the `systemState.ts` fix, deliberately not
  attempted in the same pass.
- **`domain/buildOrderTable.ts` (BuildOrderPanel's full per-row Built/Demolish/Planned ledger, added
  2026-07-27) deliberately costs every row via `ordering.ts`/`systemState.ts`'s per-tier math, never
  `solve.ts`'s own new-port MILP formula from the entry above** — that formula is a real, in-model
  number, but its per-k feasibility check tests an AGGREGATE condition ("if every non-port
  contribution were available up front, does paying for k+1 ports in some order stay non-negative"),
  not a genuine step-by-step sequence; replaying it in build order can (and did, in real user
  testing) dip the running T2/T3 total negative even when a valid, always-executable order exists.
  `computeFeasibleOrder`'s per-tier, canBuild-gated math is what actually GUARANTEES an executable
  sequence — matching this app's existing precedent (`BuildOrderPanel`/`SolvedSystemPanel` already
  treat `ordering.ts`'s own computed order as authoritative for display, never `solve.ts`'s raw
  internal port assignment; see "Port placement fidelity is deliberately approximate" below).
  Consequence: this table's own final running T2/T3 total can legitimately end up higher than
  `result.finalT2Points`/`finalT3Points`, never lower — surfaced via the panel's own caption, not
  silently. Two real bugs found via user testing here, both fixed and regression-tested
  (`domain/buildOrderTable.test.ts`): (1) a present facility the solver actually demolishes must
  still show up as a real Built row first (it's real, standing, already-generating infrastructure
  today, regardless of what this specific solve later does to it) before its Demolish row subtracts
  it back out — the first version skipped it entirely (sourcing Built rows from
  `computeSolvedPlacements`'s "present" status, which deliberately excludes anything
  `result.demolished` removes), undercounting the Built total and (compounding with the formula bug)
  driving the running total negative; (2) the formula bug described above.
  **Follow-up from the entry above, now fixed (2026-07-26):** with EXTREME demolition (marking
  most/all present facilities demolishable), `computeFeasibleOrder` used to still throw "Could not
  finish ordering" even though `solve.ts` confirmed a fully feasible optimal solution existed
  (`result.status === "optimal"`, final T2/T3 non-negative) — this was left as a deliberately
  deferred follow-up when first found (2026-07-27) rather than expanding the fix above's scope.
  Investigating it for real (reproduced against `jsons/swoilz-aw-c-d52.json` with every present
  facility marked demolishable) turned up TWO distinct, independent causes, both now fixed:
  1. **`computeFeasibleOrder`'s port queue only ever tried its head element.** If the very next port
     in `result.portOrder`'s fixed sequence wasn't affordable yet, the search gave up instead of
     checking whether a LATER port in the same queue could be built first — unlike ordinary
     facilities, which already search their whole tier list for anything currently buildable.
     Fixed by reusing that exact same `buildFirstFromList` helper for the ports queue too. Safe
     because `SystemState.constructionPoints` tracks the two escalating port-cost curves
     independently PER CLASS — reordering which port gets built first (same-class or cross-class)
     never changes what anything costs, so this can only ever unlock orderings the old code
     forbade, never produce an invalid one. See `ordering.test.ts`'s dedicated regression test
     (a hand-built repro using real Coriolis/Orbis_or_Ocellus costs, no solver needed).
  2. **A separate, deeper bug**, found while building a real-system regression test for #1:
     `SystemState.addResult` credits already-present ports via the same escalating-cost formula as
     brand-new construction (see `computePresentPortsSeed`'s stand-in-order approximation above) —
     with few or no OTHER present facilities left to "explain" how those ports were affordable
     (exactly what heavy demolition does), that computation can land NEGATIVE before a single new
     building is even attempted, and no amount of reordering can recover from a deficit that exists
     before the search loop starts. A real player's current T2/T3 balance can never actually be
     negative — this was a bookkeeping artifact of the stand-in order, not a real deficit — so it's
     floored at 0 right where `addResult` finishes crediting (see that method's own comment in
     `systemState.ts`) — this floor is internal bookkeeping only (feeds `getOrderingFromResult`'s
     order computation), never a number shown in any UI, unlike #3 below.
  3. **A THIRD issue, found via user review of #1/#2's fix**: `buildOrderTable.ts`'s own separate
     replay (`pushDemolish`, used for the Build order table's actual DISPLAYED rows, not
     `SystemState.addResult`) hit the identical "present ports' historical cost exceeds what's left
     once generators are demolished" deficit — an earlier fix floored THAT running total at 0 too,
     but since Delta still showed the true per-row value, this made Delta and Total visibly
     disagree across consecutive rows (e.g. three rows all showing Delta `-1` while Total stayed
     `0`) — correctly called out as "weird" rather than accepted. The real fix isn't a clamp: since
     demolition itself is never blocked by insufficient points in the real game (points are
     *refunded* on demolition — see the demolition-mechanics notes below), the deficit is purely an
     artifact of this table's own strict "all Demolish rows, then all Planned rows" order, not
     something a real player is forced into. Fixed by `buildOrderTable.ts`'s
     `scheduleDemolishAndPlanned`: it interleaves Demolish and Planned rows, deferring any demolish
     that would currently go negative until a Planned (rebuild) row has grown the balance back up —
     using new `SystemState.canDemolish`/`removeBuilding` methods (the demolish-side counterparts to
     `canBuild`/`addBuilding`, added for this). No floor needed anymore in `pushDemolish` — Delta and
     Total are honest and always agree. See `buildOrderTable.test.ts`'s dedicated extreme-demolition
     regression test (needs ALL THREE fixes above to pass), which also asserts genuine interleaving
     occurred (a Planned row lands before the last Demolish row), not just "happens to stay safe."
- **`SolverResult.slotsRemaining` must subtract present/primary occupancy too, not just new
  builds.** Real bug fixed 2026-07-26 (user report: a fully-built system still showed 15/16/10
  slots "left"). `usedSlots.space`/`.ground`/`allVars.Asteroid_Base` are the raw NEW-BUILD decision-
  variable sums (`allVars`, not `allValues`) — correct as-is for the per-body CAPACITY CONSTRAINT
  (which separately subtracts present-hard/present-kept/primary occupancy per body before bounding
  new construction), but the OLD reported `slotsRemaining` used them bare against the raw total slot
  count, silently ignoring everything already standing. Fixed to subtract present-hard +
  present-kept-and-not-demolished + the primary's reserved slot too (see the block right before
  `solve()`'s `return`). Aggregate mode's formula is untouched (protected by the `bodies: []`-vs-
  omitted byte-identical regression test) — `presentSplit`/`presentKeepVars` are always empty there,
  so the new per-body-only terms are all 0 and it reduces to exactly the old formula. The `asteroid`
  figure needed a second fix on top: asteroid-eligible slots are a SUBSET of orbital slots (any
  orbital slot on a ring-eligible body — see `JournalBody.slots.asteroid`'s doc comment), so
  occupancy there must count ANY building on a ring-eligible body, not just `Asteroid_Base`
  specifically (the first fix pass still only checked for `Asteroid_Base`, which could
  contradictorily report asteroid slots free while plain orbital slots — a superset — were already
  fully used). `solve.test.ts` has dedicated regression tests for both.

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
  test even starts.** Not a real test failure and not this file's fault — it's Vitest's own
  hardcoded, non-configurable 60s worker-ready timeout (`START_TIMEOUT` in
  `node_modules/vitest/dist/chunks/cli-api...js`; no `vitest.config.ts` option controls it) getting
  tripped by how long it takes to transform/import this file's dependency graph (the whole app, plus
  the HiGHS WASM solver's jsdom fallback path — see the gotcha above) under jsdom, which can
  legitimately take 40–90s+ depending on how loaded the sandbox is. Confirmed 2026-07-27: switching
  `test.pool` from the default `'forks'` to `'threads'` (cheaper to spin up than a full OS process
  fork) made no difference — same 60s timeout, same "environment: 0ms" (never even got past worker
  bootstrap) — so it's genuinely transform/import cost, not fork-vs-thread process overhead, and
  isn't fixable via pool choice. When this happens, just retry the same command — it's not
  deterministic, and reran successfully within 1–4 retries every time this was hit. See the
  Workflow constraints section below for when to actually run this file at all.
- UI changes should be verified in an actual browser, not just component tests — this project doesn't
  have a committed browser-driving setup yet (Playwright was installed ad hoc, `--no-save`, during
  development sessions and isn't a project dependency). If you need to do this again and it's not a
  quick one-off, consider running `/run-skill-generator` to make it a proper reusable project skill.
- **`jsons/swoilz-aw-c-d52.json` is a real exported system (the user's own, committed to the repo —
  see `SystemPortabilityBar.tsx`'s export format) and is always fair game as a test-data source.**
  Free to read it directly, load it in an ad-hoc reproduction script (e.g. a temporary
  `src/_debug.test.ts` run via `vitest run` and deleted afterward — this is exactly how the
  `slotsRemaining`/`systemState.ts` port-escalation/`economySynergyCoefficient` bugs above were each
  reproduced and confirmed fixed), or reference in a real regression test. It's real, played-out
  in-game data — already-built facilities, real body attributes, a real primary station — so it's
  also the go-to way to cross-check this app's computed numbers (scores, links, slot counts, T2/T3
  balance) against actual reported in-game values when the user says something looks wrong; don't
  hesitate to reach for it first instead of constructing a synthetic fixture from scratch. Multiple
  bugs in this file were found exactly this way. If more `jsons/*.json` files show up locally later,
  treat them the same way unless told otherwise — this is the first and, as of this note, only one
  actually committed (an earlier version of this doc's "Update 3 link/economy modeling" section
  called every `jsons/*.json` file "not committed," which was already stale for this one).
- **`src/realSystems.test.ts`** (added 2026-07-26, at the user's request) makes the above permanent
  and automatic instead of ad hoc: `describe.each` over every `*.json` file actually present in
  `jsons/` (so dropping in another real exported system extends this suite with zero code changes —
  no registration list to update), each run through the exact same pipeline a real "Solve for a
  system" click plus the "Solved system" panel's own post-solve computations perform — `solve()`
  with the app's real default objective (via `App.tsx`'s exported `buildSolverInput`, not a
  hand-rolled reconstruction of it, so the test can't quietly drift from what the app actually does),
  then build order (`getOrderingFromResult`) + link topology (`computeSolvedSystemLinks`) + per-slot
  placement seating (`computeSolvedPlacements`). Asserts the invariants the four real bugs above each
  broke: `slotsRemaining`/T2/T3 never negative, build order never throws, links never throw,
  `computeSolvedPlacements`'s `warnings` stays empty. This is deliberately the broadest smoke test in
  the project — closer to `App.test.tsx`'s end-to-end spirit than a narrow unit test, but without a
  DOM (pure solver/domain pipeline) so it can run fast and `describe.each` cheaply over many systems.
  `tsconfig.app.json` needed `"node"` added to its `types` array for this file's `node:fs`/`node:path`
  usage — ambient types only, doesn't change what runs in the browser.
- **`spansh-jsons/swoilz-aw-c-d52-dump.json`** (added 2026-07-26) is a real Spansh `/dump/{id64}`
  response for the same real system as `jsons/swoilz-aw-c-d52.json` above, committed for the same
  reason — free to use directly in tests or an ad-hoc reproduction script. `src/spansh/adapter.test.ts`
  and `src/spansh/realSpanshSystem.test.ts` (the Spansh-path sibling of `realSystems.test.ts` above,
  not folded into its `describe.each` since the input shape differs) both use it.
  `spansh-jsons/swoilz-aw-c-d52-query.json` (a `/systems/field_values/name` typeahead response) is
  also committed and used by the same tests. (An earlier `/system/{id64}` endpoint's sample response
  briefly existed alongside these during investigation — see "Spansh import" above for why that
  endpoint was dropped — but was never committed and no longer exists on disk.)

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
and all of `domain/economyOverrides.ts`, `domain/links.ts`. (A third module,
`domain/stationServices.ts`, implemented the station-service-unlock rules below until it was
removed 2026-07-26 along with its only consumer, the standalone "Links & economy" panel — see the
"Station service activation rules" subsection below for what it used to cover.)

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

**Station service activation rules** (2025-06-04), condensed. *Not currently implemented in
code* — this was `domain/stationServices.ts`'s job until it was removed 2026-07-26 along with its
only consumer, the standalone "Links & economy" panel (judged redundant with the "i" info icons
shown throughout the rest of the app, which never surfaced station-service availability). Left here
as reference in case that gap is worth closing a different way later:
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
  Settlements (not a port — was out of this app's ports-only scope even when implemented).
- **Vista Genomics**: T3 port; a Tier 1 Planetary Port or T2 port + (strong link to a
  Satellite/Comms/Relay, OR a Medical Installation/Scientific Hub in system).
- **Black Market**: Pirate Outpost (no exact building-name match — was mapped to `Criminal_Outpost`
  when implemented); any port + a strong link to a Pirate Installation.
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
`SUBSEQUENT_FACILITY_REDUCTION` in `data/buildings.ts` (moved there from `solve.ts` 2026-07-26 once
`domain/currentSystemScores.ts` needed the same constants for a plain-number reweight — it's a
general game rule, not something specific to the solver's own LP formulation), repeated here for
completeness: first station +40%/+40%/+40%/+20%/+40% (development level/security/standard of
living/tech level/wealth); subsequent facilities −10%/−10%/−20%/−25%/−25% (same five, same order).

### Design notes

**The solver's objective now DOES take link/economy into account, via `economy_synergy` — this
superseded an earlier version of this section** (kept below, struck through in spirit not in
markup, for anyone reading old PR history/comments referencing it) that said "the solver's
objective/scores are untouched by this feature... no existing score for link topology to feed
into, and none was invented." That was true through the initial link/economy display work,
but user feedback (2026-07-25) overrode it: with Update 3+'s rules in place, recommending a layout
that never considers *which body* suits *which* economy type isn't good enough, even without a full
commodity-quantity model. See `solve.ts`'s header comment (search `economy_synergy`) for the exact
mechanism: each candidate (building, body) pair gets a coefficient from
`domain/economyOverrides.ts`'s existing verbatim strong-link boost/decrease table
(`computeBoostDecrease`), applied to that building's own economy type(s)
(`facilityBaseEconomies`) as if a strong link to it had already formed — regardless of whether one
actually would in the final solved layout. This is a real, new approximation (not verbatim-sourced),
added to the "Explicitly unverified/best-effort constants" section above; it is deliberately NOT an
attempt to embed the full strong/weak-link *graph* (which body's port is dominant, etc.) inside the
MILP — that depends circularly on the very placement decisions being solved for, and doing it exactly
would need to know link topology before solving for the layout that produces it. `economy_synergy` is
exposed as an ordinary `Score` (letter `y` in custom objective expressions) — see `ObjectivePanel`'s
default expression, which now includes it. Body placement (`SolverInput.bodies`) still *also* enters
the MILP purely as a *feasibility* constraint (real per-body slot capacity, replacing the old 3
aggregate slot pools when present) and still separately feeds `domain/links.ts`'s post-solve
computation for the "i" info icons' exact link topology — `economy_synergy` is additive to both of
those existing roles, not a replacement for either.

**Backward compatibility is load-bearing, not incidental.** `SolverInput.bodies` absent/empty (the
default — anyone using only the System facilities panel's aggregate slot fields) reproduces today's exact
solver behavior; `PlannerFormState.bodies` empty is the same signal at the state layer. This is
covered by an explicit regression test in `solve.test.ts` (`bodies: []` vs. omitted must be
byte-identical) — don't remove it if you touch `solve.ts`'s per-body code paths. `SolverBody.economy`
(feeding `economy_synergy` above) is its own nested opt-in on top of that: a body present but with
`economy` omitted contributes 0 to `economy_synergy` rather than erroring, same degrade-gracefully
pattern — covered by its own dedicated `solve.test.ts` case, separate from the `bodies: []`-vs-omitted
one.

**Port placement fidelity is deliberately approximate, not exact**, for the rare case of two
*different* port types tied in tier landing on the same body: `solve.ts` doesn't thread body
assignment through the `port_k` build-sequence index (which would require a `5 building types × 20
slots × N bodies` variable blow-up with heavy MILP symmetry); `domain/links.ts`'s tie-break instead
uses the solved `portOrder` as an approximate signal. This never affects what the solver
recommends building — only a display-only tie-break in the "i" info icons' link/economy display.

**`getPortTier()` reuses existing `T2points`/`T3points === "port"` fields**, matching the official
"Tier 1/2/3 Port" vocabulary from the June 2025 patch — but that source's tier language is actually
about a specific port *instance's* own upgrade investment (has this specific port had T2/T3 points
spent on it yet), which this app's solver doesn't track at all (only aggregate points system-wide):
treating every instance of a tier-2/3-capable building type as already at its ceiling is an
optimistic approximation. (This used to also overstate *station-service* availability for a
freshly-built, not-yet-upgraded port — no longer a live concern now that station-service modeling
itself has been removed, see the "Station service activation rules" subsection above.)

**`SolverResult.placements` is new-builds-only — feeding it alone to `computeSystemLinks` silently
drops every already-present facility's link contribution.** Real bug found 2026-07-26 (user report:
"already built facilities are not provid[ing] strong nor weak links in the solved system"):
`solve.ts` folds already-present facilities into the MILP as plain constants, never as their own
`bodyVars` decision-variable entry, so they never appear in `placements` at all — only newly-solved-
for buildings and the primary station's own fixed reservation do (see `solve.ts`'s `placements`
construction). Both `LinksPanel.tsx` and `SolvedSystemPanel.tsx` used to call `computeSystemLinks`
with `result.placements` directly, which meant a system with any already-built, non-primary
facility (nearly every real system) showed an incomplete link graph for its SOLVED state — present
facilities' economy contribution just vanished from the "Links & economy" panel and the "Solved
system" tree's info hovers, even though `SystemConfigPanel.tsx`'s own present-only view
(`domain/presentLinks.ts`) always got this right. Fixed via `domain/solvedLinks.ts`'s
`computeSolvedSystemLinks`, which merges `result.placements` with the same present-facilities
conversion `presentLinks.ts` uses (excluding whatever `result.demolished` actually removed) before
calling `computeSystemLinks` — both panels now use that instead of calling `computeSystemLinks`
directly. If you add a third caller of a solved plan's link topology, use
`computeSolvedSystemLinks`, not `computeSystemLinks(bodies, result.placements, ...)` directly.

### Per-facility economy ratio accumulation (System facilities panel hover — user-supplied, not verbatim source text)

The System facilities panel's per-facility hover ("i" icon on a built slot) shows an "Economy
ratios" block (per economy: total, then a body/strong-link/weak-link breakdown) and a "Market
links" block (a 3-column Economy/Strong link/Weak link table of *counts*, not percentages) — this
is entirely user-supplied real-game-testing rules, not from any official patch note text (which
only ever says links "supply a proportion" of an economy, never a number). Implemented in
`domain/links.ts`'s `computeSystemLinks` (`PortEconomyLine`/`MarketLinkLine`), consumed by
`facilityEconomyRatios`/`facilityMarketLinks` — moved out of `SystemConfigPanel.tsx` into
`components/FacilityInfo.tsx` (2026-07-26) once `SolvedSystemPanel.tsx`'s read-only "Solved system"
tree needed the exact same "i" info icons (`FacilityInfoIcon`/`BodyInfoIcon`) fed a *different*
`SystemLinksResult` — the present-only one from `domain/presentLinks.ts` for the "Actual facilities"
tree, `domain/solvedLinks.ts`'s solved one (see above) for the "Solved system" tree. Rules, in order
of discovery/confirmation:

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
exported system (`jsons/swoilz-aw-c-d52.json` — the user's own save data, committed to the repo; see
"Testing conventions" below for how freely this is meant to be used) rather than just theoretical
worked examples.

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
- **Same treatment for `App.test.tsx`** (2026-07-27, user request: its worker-start flakiness — see
  "Testing conventions" above — "really slows down the flow"): don't run it after every small edit
  during iteration/fine-tuning; a `tsc -b` pass plus the narrower test file(s) actually touched by
  the change is enough signal in the moment. Run it once, same as the browser tests, near the end of
  the session as part of final verification — and if it hits the worker-timeout flake there, just
  retry the same command rather than treating it as a regression to investigate.