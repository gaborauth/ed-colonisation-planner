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
   against your in-game System Map. Clicking **Apply slots and body layout to Actual facilities in
   the system** switches the solver into *per-body placement* mode (real per-body slot capacity)
   instead of just aggregate totals.
2. **Actual facilities in the system** — pick your primary station (required, and visually
   highlighted until you do), then mark what's already built in each body's slots using the tree
   below (one dropdown per physical orbital/ground slot). Flag an already-built facility
   **Demolishable** to let the solver optionally remove it — refunding its stat/T2/T3 contribution
   and freeing its slot — if replacing it scores better; ports can't be demolished. A genuinely
   empty slot can instead be marked **Leave empty**, telling the solver to never place anything
   there at all (distinct from just setting a body's slot count to 0). Your current T2/T3
   construction-point balance is derived automatically from what you mark here, not entered by hand.
   Hit **Save** (top toolbar) to persist your already-built layout for next time.
3. **Objective** — maximize a single system score (construction cost is minimized instead), or write
   a custom expression (`sqrt(w) + sqrt(n)`, `2*w + t - abs(w - 2*t)`, etc.) over the score letters
   `i m e t w n d c`. Two optional, foldable sub-sections sit below it: **Score constraints** (min/max
   bounds per score) and **Economy preferences** (per-body layout only) — a Must / Want / Dunno /
   Don't want / Forbid choice per Update 3 economy type, letting you steer which economies the
   solver favors or avoids on top of its aggregate scoring.
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
   a running T2/T3 point total per row and a Total row for the solver's own final numbers.
6. **Saved plans** — save/load plans locally (browser storage), delete a saved system you no longer
   need, or export/import a plan as a file to move it between browsers.

## Update 3: links & economy

Elite Dangerous's Update 3 (2025-04-27) reworked how colonised systems' economies work: completed
constructions automatically link to each other, and those links determine what's tradeable at each
port. In per-body mode (see step 1 above), this planner now shows that link network for whatever
the solver recommends building:

- **Ports** (Outposts, Coriolis/Orbis/Ocellus/Dodecahedron stations, Asteroid Bases, Planetary
  Ports) get **Strong links** from any facility on the same body, and **Weak links** (a smaller
  boost) from ports/facilities on other bodies in the system. If a body has more than one port, the
  highest-tier one gets the strong links.
- Each port's economy type is normally "Colony," but gets overridden/added to depending on the body
  it's on or orbiting — an Earth-like world adds Agriculture/HighTech/Military/Tourism, a ringed
  body adds Extraction, an icy body adds Industrial, and so on.
- Strong links (only) get a further boost or penalty from body/system characteristics — e.g. an
  Extraction link is boosted on a volcanic body or in a resource-rich system, and an Agriculture
  link is penalized on an icy or tidally-locked body.
- In the **Actual facilities in the system** panel, hovering a built facility's "i" icon shows an
  "Economy ratios" breakdown (total economy per type, broken down into body/strong-link/weak-link
  sources) and a "Market links" table (how many strong- and weak-link building instances feed each
  economy).

A few of the game's own trigger conditions (a body having organics, geologicals, or volcanism; a
system's overall resource richness) aren't reported anywhere in the Elite Dangerous Journal files
this tool reads — those are shown as "unknown" rather than silently assumed absent. This tool still
doesn't simulate actual commodity supply/demand (what's buyable, in what quantity) — only the
qualitative link topology and economy types above. See `CLAUDE.md` for the full verbatim rule
tables this is built from, if you want to check the implementation against the source patch notes.

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
construction-progress/demolition tracking — see [Update 3: links & economy](#update-3-links--economy)
above for what *is* modeled from that patch.

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

## Feedback

Issues and feature requests welcome.

---

EDCPS is not affiliated with [Frontier Developments](https://www.frontier.co.uk/), the developers of
[Elite Dangerous](https://www.elitedangerous.com/).
