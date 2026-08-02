# EDCPS: Elite Dangerous Colonisation Planner & Solver

A browser-based planner for Elite Dangerous system colonisation. Give it your available construction
slots (or let it estimate them from an uploaded Journal file), pick an objective, and it uses a MILP
solver to work out which facilities to build — taking construction points, facility dependencies, and
the escalating cost of building multiple ports into account.

Runs entirely client-side: no backend, no account, nothing leaves your browser. The solver
([HiGHS](https://highs.dev/), via WebAssembly) runs locally against the data you enter. The one
exception: the **Spansh** import tab (see below) queries Spansh's public system database through a
small CORS proxy to fetch that system's data — everything else, including the Journal-file import
path, stays fully local.

## Using it

Open the app (see the GitHub Pages link at the top of this repo, or run it locally — see below).

**No journal file handy?** Click **Live Demo** (next to the toolbar's **Import system** button) to
load a real, already-played example system and try the planner immediately — no upload needed. Once
more than one system has been loaded/saved, a dropdown appears there too, letting you switch between
them directly without reopening the Import system panel below.

Otherwise:

1. **Import system** — either upload an Elite Dangerous Journal `.log` file (**Journal file** tab) to
   get a starting estimate of each body's buildable slots from your own scanned system data, or
   search Spansh's public system database by name and load a starting point directly (**Spansh**
   tab) — handy for a system you haven't personally scanned yet (Spansh's signal/genus data reflects
   whoever last scanned that body in its own database, not necessarily your own play session).
   Either way, the slot-count estimate is a best-effort guess (see
   [Known limitations](#known-limitations)) and pre-fills editable fields — always sanity check it
   against your in-game System Map. Already tracking this system's construction in
   [Raven Colonial](https://ravencolonial.com/)? Upload its "Export backup" JSON file to overlay its
   slot counts and built facilities onto the system loaded above (Raven Colonial's own body/orbital
   data is never used — only its slots and built-facility list). Clicking **Apply slots and body
   layout to Actual facilities in the system** switches the solver into *per-body placement* mode
   (real per-body slot capacity) instead of just aggregate totals.
2. **Actual facilities in the system** — pick your primary station and which body it's on (both
   required, and visually highlighted until you do), then mark what's already built in each body's
   slots using the tree below (one dropdown per physical orbital/ground slot). Flag an already-built
   facility **Demolishable** to let the solver optionally remove it — refunding its stat/T2/T3
   contribution and freeing its slot — if replacing it scores better; ports can't be demolished. A
   genuinely empty slot can instead be marked **Leave empty**, telling the solver to never place
   anything there at all (distinct from just setting a body's slot count to 0). Your current T2/T3
   construction-point balance is derived automatically from what you mark here, not entered by hand.
   The **System resource level** dropdown (Pristine/Major/Common/Low/Depleted, defaulting to
   Pristine — most colonizable systems are, and it's auto-filled from a scanned ringed body when
   your import has that data) feeds the Extraction/Industrial/Refinery boost-decrease below. Hit
   **Save** (top toolbar) to persist your already-built layout for next time.
3. **Objective** — maximize a single system score (construction cost is minimized instead), or write
   a custom expression (`sqrt(w) + sqrt(n)`, `2*w + t - abs(w - 2*t)`, etc.) over the score letters
   `i m e t w n d c y p` (population increase, security, tech level, wealth, standard of living,
   development, construction cost, economy fit, and your economy preference choices below). Two
   optional, foldable sub-sections sit below it: **Score constraints** (min/max bounds per score) and
   **Economy preferences** (per-body layout only) — a "No preference" checkbox (the default) plus a
   0-200 slider per Update 3 economy type, letting you steer which economies the solver favors or
   avoids on top of its aggregate scoring. Unchecking the box and dragging the slider below 50 makes
   the solver avoid that economy (a soft pull, stronger toward either end); dragging it to exactly 0
   forbids that economy outright — a hard exclusion, not a nudge.
4. **Buildings** — pin per-building Min/Max counts, and hover a building's total (after solving)
   to see its contribution to each score. The "Already present" column is only editable without a
   journal-imported body layout — with one, it's a read-only mirror of the Actual facilities in the
   system tree.
5. Hit **Solve for a system**. A blocking dialog shows solve progress (or any error) until it's
   done. The **Solved system** panel then shows the resulting scores, remaining slots/points, and
   the per-body proposed layout with its Update 3 Strong/Weak links and economy types (hover any
   facility's "i" icon) — a demolish immediately followed by rebuilding the identical building type
   is automatically treated as a no-op rather than recommended as real (wasted) construction. The
   **Build order** panel below it lays out the whole plan as one numbered, color-coded table — every
   facility instance, already built, marked for demolition, or newly planned, in build order — with
   a running T2/T3 point total per row and a Total row for the solver's own final numbers. If this
   system had a Raven Colonial backup imported (step 1), an **Export Raven Colonial** button appears,
   downloading the solve's newly-proposed builds as Raven Colonial "plan" sites you can re-import
   there (beta, untested — a solver-proposed demolition of an already-built site has no
   representation in this export).
6. **Saved plans** — save/load plans locally (browser storage), delete a saved system you no longer
   need, or export/import a plan as a file to move it between browsers.

## Staying up to date

This app silently updates itself on your next page reload — no install prompt, no manual update
step. The first time you load it after a new release, a one-time **What's new** popup summarizes
what changed since your last visit (Features/Bug Fixes, straight from the project's own
[CHANGELOG.md](CHANGELOG.md)); dismiss it and it won't reappear until the next release. The
version number in the footer always links to the full release history if you want to check it
again later.

## Update 3: links & economy

Elite Dangerous's Update 3 (2025-04-27) reworked how colonised systems' economies work: completed
constructions automatically link to each other, and those links determine what's tradeable at each
port. This section is the full verbatim rule set this planner is built from (official Frontier
patch notes, plus the Type-11 and Dodec updates); source references for anything *not* stated
verbatim by Frontier live in `CLAUDE.md` instead.

**Ports vs Supporting Facilities**: Ports = Outposts, Coriolis/Orbis/Ocellus Stations, Asteroid
Bases, Planetary Ports, Planetary Port Outposts. Supporting Facilities = Settlements,
Installations, Hubs.

**Strong vs Weak links**: Strong links form between a port and any facility on/around the same
body, and between multiple ports on the same body (highest tier wins; ties broken by build order,
earlier wins). If a body has both a planetary and a space-based port, planetary facilities
strong-link to the planetary port, which passes those links onward to the orbital port (same
tier/order priority). Weak links form between ports and facilities on *different* bodies in the
same system. Both link types can coexist (one facility can supply several ports). Links only ever
form port↔facility or port↔port — never facility↔facility. A port can carry multiple economy types
at once; each additional type via a link proportionally introduces trade in that type.

**Strong-link boost/decrease table** — only strong links are affected, weak links never are:

| Economy | Boosted by | Decreased by |
|---|---|---|
| Agriculture | orbiting an ELW; on/orbiting a terraformable body; on/orbiting a body with organics | on/orbiting an icy body; a planet tidally locked to its star; a moon tidally locked to its planet whose parent chain up to the star is also tidally locked |
| Extraction | system has major/pristine resources; on/orbiting a body with volcanism | system has low/depleted resources |
| High Tech | orbiting an ammonia world; an ELW; on/orbiting a body with geologicals or organics | — |
| Industrial & Refinery | system has major/pristine resources | system has low/depleted resources |
| Tourism | ammonia world; system has a black hole; ELW; geologicals; organics; water world; system has a white dwarf or neutron star | — |

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

**"Economy ratios" and "Market links" hover** (the "i" icon on any built/proposed facility, in both
the **Actual facilities** and **Solved system** panels): a strong link contributes 40%/80%/120% of
its own economy to the linked port depending on the giving facility's tier, plus that economy's own
boost/decrease delta on the shared body (e.g. a Military Settlement's own Military value is 100%,
but it only contributes 40% to a linked port). A weak link always contributes a flat 5%, regardless
of tier, from every strong-link-giving facility system-wide to every *other* body's representative
port (a facility on a port-less body still weak-links elsewhere, even though it can't strong-link
locally). The "Market links" table shows *counts* of contributing building instances per economy,
not weighted amounts.

**Station service activation rules** (official, but not modeled by this planner — this tool answers
"what should I build," not "which services will each station end up with"): Commodities Market
(all T2/T3 ports, all Settlements, or a civilian-type Outpost with the right link); Shipyard/
Outfitting (need system tech level ≥ 35, granted by any T2/T3 port); Universal Cartographics; Vista
Genomics; Black Market (needs a linked Pirate Installation); Crew Lounge; Pioneer Supplies (every
port, unconditionally). Station interiors additionally shift weekly based on the highest-proportion
economy present — also not modeled (no commodity-proportion simulation).

**Population growth**: grows significantly faster with a significantly higher cap than pre-Update-3;
overall capacity is still determined by which port/facility types are built; growth happens on
weekly maintenance ticks along a curve that's fast for the first month, then slows. Not simulated
by this planner.

**Demolition/cancellation**: constructions and completed facilities can be marked for demolition,
removed at the next weekly maintenance (cancelable before then); the primary/initial port can't be
demolished; slots and construction points are refunded; a facility must be demolished before the
prerequisite it depends on (unless another instance remains); missions at a demolished facility are
deleted; commodities already committed to a cancelled construction are lost. This planner models a
narrow slice: mark an already-built facility "demolishable" in **Actual facilities in the system**
and the solver may remove it (refunding its stat/T2/T3 contribution, freeing its slot) if replacing
it scores better — instantly, not on a weekly tick. No mission tracking, no partial/in-progress
construction, and the primary station plus the 5 escalating-cost-curve port buildings (Coriolis,
Asteroid Base, Orbis/Ocellus, Dodecahedron, Planetary Port) are never demolishable.

**Dodec Update score-weighting**: the first station built gets +40%/+40%/+40%/+20%/+40%
(development level/security/standard of living/tech level/wealth); every subsequent facility gets
−10%/−10%/−20%/−25%/−25% (same five stats, same order).

A few of the game's own trigger conditions (a body having organics, geologicals, or volcanism; a
system's overall resource richness) aren't reported anywhere in the Elite Dangerous Journal files
this tool reads — those are shown as "unknown" rather than silently assumed absent. This tool still
doesn't simulate actual commodity supply/demand (what's buyable, in what quantity) — only the
qualitative link topology and economy types above.

## Known limitations

A few pieces are explicitly best-effort and flagged as such in both the code and the UI:

- **Journal → slot estimate** (`src/journal/eligibility.ts`): no official formula for how scanned
  body data maps to buildable slot counts was locatable. The heuristic there is a reasonable guess,
  isolated in named constants for easy correction — if you compare it against a real System Map and
  it's off, that's the file to fix.
- **Facility → economy-type mapping** (`src/data/buildings.ts`, `FACILITY_ECONOMY_GUESS`): Update
  3's official body-attribute economy-override table is sourced verbatim from patch notes, but no
  official mapping from every Hub/Settlement/Installation building to an economy type was ever
  published — that mapping is inferred from naming and flagged as a guess; some buildings are left
  deliberately unmapped rather than guessed.
- **Spansh import's planet-class/star-type mapping** (`src/spansh/adapter.ts`): Spansh's system
  database uses slightly different wording than the Journal for some body/star types — translated
  via a small lookup table built from general game knowledge, but only actually verified against one
  real committed example system. If a system you load through the Spansh tab looks misclassified,
  that's the file to check.
- **Strong/weak link contribution rates** (`src/domain/links.ts`): the official patch notes only say
  a link "supplies a proportion" of an economy, never a number. The tier-scaled strong-link rate is
  community-sourced; the flat 5% weak-link rate has no official-source equivalent at all. Both have
  been checked against a real in-game system's exact reported percentages and link counts, but treat
  them the same as everything else here. Separately, one specific Outpost type (Criminal) has a real
  in-game economy ("Contraband") this tool has no way to represent at all — it falls back to an
  approximation rather than a confirmed value.

If you have more accurate numbers for any of these, they're all single, well-commented constants to
edit.

Also out of scope: real commodity supply/demand simulation (exact tradeable quantities) and
full construction-progress/demolition tracking — see [Update 3: links & economy](#update-3-links--economy)
above for what *is* modeled from that patch. The DaftMav/Scuffed community-tool text import/export
format from the original Python version of this tool was dropped, not ported, in the rewrite — a
future EDDN-based import is the intended replacement path, not restoring the old text format.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # vitest — solver tests run the real HiGHS WASM solver, not mocks
npm run build    # production build to dist/
npx tsc -b       # typecheck only
npx oxlint       # lint
```

Deploys automatically to GitHub Pages on push to `main` via GitHub Actions
(`.github/workflows/deploy.yml`).

### Branching and releases

Branch flow: feature branches → `development` → `main`. Versioning is fully automated via
[semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.). A
push to `main` computes the next semver bump from commit history, regenerates `CHANGELOG.md`, tags,
and publishes a GitHub Release; a push to `development` only dry-runs the same process (validates
commit messages, logs what version *would* ship, but never tags or publishes). This package is
`private` and never published to the npm registry. Dependabot opens dependency-update PRs against
`development` weekly with a `chore` prefix, which doesn't trigger a version bump on its own.

## Data source

Building stats and costs come from DaftMav's community-maintained
["Colonization Construction v3"](https://forums.frontier.co.uk/threads/v3-of-the-colonization-construction-spreadsheet-is-now-available.635762/)
spreadsheet.

## Feedback

Issues and feature requests welcome.

---

EDCPS is not affiliated with [Frontier Developments](https://www.frontier.co.uk/), the developers of
[Elite Dangerous](https://www.elitedangerous.com/).
