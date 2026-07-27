## 1.0.0 (2026-07-27)

### Features

* add about and help panel ([5c8b675](https://github.com/gaborauth/ed-colonisation-planner/commit/5c8b675bd1a1fd7e442f571715685d0acd120c79))
* add release workflow ([1f21331](https://github.com/gaborauth/ed-colonisation-planner/commit/1f21331944b5a6640e46aeca8983e49dc0582b12))
* add Spansh system import ([c6cdc1e](https://github.com/gaborauth/ed-colonisation-planner/commit/c6cdc1eca037f35d60694bf24451637d79f4b556))
* added buy-me-a-coffee support links ([93f7017](https://github.com/gaborauth/ed-colonisation-planner/commit/93f7017e1f82c95bcceb3d0ceacb50bd95ed71ff))
* migrate from Python to React ([3d253c9](https://github.com/gaborauth/ed-colonisation-planner/commit/3d253c9069e3cde1fc5d348d562a909ad1ec414c))
* persist journal-imported systems across page reloads ([ed698f8](https://github.com/gaborauth/ed-colonisation-planner/commit/ed698f89b45f643bf254fb4a00ad60ae50550692))

### Bug Fixes

* add opt-in analytics, and polish the UI ([4d5af90](https://github.com/gaborauth/ed-colonisation-planner/commit/4d5af90d57d2540d3794c9f5215981854ce05154))
* add specialized-port economy display ([c4d3023](https://github.com/gaborauth/ed-colonisation-planner/commit/c4d30237e623add5e17ae3bd54029c8f3ea1db5e))
* build-order scheduling/ordering bugs and off-main-thread solving ([b5c38d0](https://github.com/gaborauth/ed-colonisation-planner/commit/b5c38d044d94f686c988d4c9105fda5532f3d91c))
* change GA async loaded code ([f222324](https://github.com/gaborauth/ed-colonisation-planner/commit/f2223246d64e709107d9deaa5bee87c097baf4d8))
* facility variants/nicknames, slot-usage summary, and a T2/T3 points accounting fix ([baec101](https://github.com/gaborauth/ed-colonisation-planner/commit/baec101dc7775e4f81a318ec5fba1d93dcff8ccd))
* fire script onload manually in test instead of moving gtag calls out of onload ([6e87538](https://github.com/gaborauth/ed-colonisation-planner/commit/6e87538b29f614d7f2e9e7b605fd319ab1d9c344))
* full per-row Build order ledger table ([576ef64](https://github.com/gaborauth/ed-colonisation-planner/commit/576ef645eb97903e62fb5088dab7e0de23562fd2))
* guard smooth scroll call in journal apply flow ([10c767e](https://github.com/gaborauth/ed-colonisation-planner/commit/10c767e78663eb749bea63a3e7aac0763b15c921))
* make the solver economy-aware and consolidates the UI ([f0a0ff9](https://github.com/gaborauth/ed-colonisation-planner/commit/f0a0ff9fb91577085590d2d5acb31f7e3fc77645))
* move gtag js/config calls out of onload to fire immediately ([6886fd6](https://github.com/gaborauth/ed-colonisation-planner/commit/6886fd6dc57af08d9efe32a3d027334427ed8e22))
* per-body strong-link economy modeling ([15c1b22](https://github.com/gaborauth/ed-colonisation-planner/commit/15c1b2214ab0b4e49f319cc1e0bde0c0a422e7ad))
* rename Buildings pane to Constructions, add social-share preview ([ad3880f](https://github.com/gaborauth/ed-colonisation-planner/commit/ad3880fa4df176ca647c7d198801c8a4ee88af64))
* surface score constraints inline and UI polish ([38867fd](https://github.com/gaborauth/ed-colonisation-planner/commit/38867fd132b93a1c3d22922c02501eaa36cfc7e5))
* system export/import, sticky toolbar, and primary station slot accounting ([eab410d](https://github.com/gaborauth/ed-colonisation-planner/commit/eab410d71434faedbeb2c36e1f241f8808ca6583))

## Project history

**2026-07 — rewritten as this app.** The desktop GUI was replaced by this stateless,
client-only React app: a MILP solver (HiGHS, compiled to WASM) that runs entirely in the browser,
with no backend and no account. Persistence (saved plans, saved journal-imported systems) is
localStorage-only. The rewrite tracks Elite Dangerous' own changes since the original tool went
dark — most notably Update 3's colonisation link/economy rework and the Trailblazers Update — none
of which the Python tool ever supported. The only exception to "fully client-side" is the Spansh
import tab, which calls a small self-hosted CORS proxy purely to look up a system by name before
loading it; Journal-file import remains fully backend-free either way.

**2025-03 to 2025-04 — the original tool.** This project began as *EDColonizationPlanner*, a
Python/Tkinter desktop app started by rlry1111 on 2025-03-17, right at colonisation's original
launch, with Lionel Eyraud-Dubois (Nagael) as the main subsequent contributor. Over about a month
it grew a Tkinter GUI, a PuLP/SCIP-backed MILP solver, save/load, custom-objective support, and
import/export to other community tools, before development stopped in mid-April 2025. The Python
source no longer exists in the working tree, but is still recoverable from git history (see
`git log --diff-filter=D --summary -- '*.py'`) if anything from it is ever needed again.
