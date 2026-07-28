// Raven Colonial's per-site `buildType` string (e.g. "quad_truss", "picumnus") is a specific
// in-game construction LAYOUT name, not this app's own building identifier — a building category
// can offer several interchangeable layouts (e.g. Coriolis: no_truss/dual_truss/quad_truss; a
// Civilian Planetary Outpost: Hestia/Decima/Atropos/Nona/Lachesis/Clotho), and Raven Colonial's
// per-system export only ever records ONE of them per site, with no separate "category" field to
// cross-check against. This table maps every known layout name (lowercased) to this app's building,
// slotKind, and — best-effort — the matching `variant` display name (data/buildings.ts's
// `BUILDING_VARIANTS`).
//
// Source: SrvSurvey's community-maintained `colonization-costs2.json` (github.com/njthomson/
// SrvSurvey — the same project Raven Colonial itself builds on), which lists all 55 real building
// categories together with every layout name each one can produce. Covers all 54 buildings in this
// project's own `data/buildings.ts`. Only 8 entries (pistis, picumnus, silenus, harmonia, nemesis,
// quad_truss, apollo, hestia) are cross-checked against a real Raven Colonial export
// (`rc-jsons/swoilz-aw-c-d52.json`, matched by customName against the same system's real committed
// `jsons/swoilz-aw-c-d52.json` export); the rest are best-effort/unverified against real Raven
// Colonial data, same treatment as this project's other community-sourced tables (see CLAUDE.md's
// "Explicitly unverified/best-effort constants").
//
// Two caveats in the table itself:
// - "Research Bio Settlement" (small/medium/large) has no literal "Bio" counterpart anywhere in
//   `data/buildings.ts` — mapped to this app's own Small/Medium/Large_Scientific_Settlement (which
//   already feeds into Research_Station, matching Research Bio's real in-game role), since nothing
//   else in the building list fits. Unverified.
// - "tellus" is genuinely ambiguous in the source catalog itself — the exact same layout name is
//   shared verbatim between Exploration Hub (its ONLY layout) and one of Industrial Hub's three
//   layouts, and Raven Colonial's per-site export has no other field to disambiguate which one a
//   real "tellus" site actually is. Mapped to Exploration_Hub here (without this, "tellus" would
//   never resolve to Exploration_Hub at all, since Industrial Hub has two other unambiguous layouts
//   of its own) — worth double-checking if a real import ever needs the other one of these two hub
//   types instead.
//
// `variant` is matched against `BUILDING_VARIANTS` case/spacing-insensitively; 5 of 109 needed a
// manual override where the names don't line up 1:1 (`apollo`/`artemis` -> "Orbis (Apollo)"/"Orbis
// (Artemis)"; `dodec` -> "No Truss Dodo"; `tellus` -> "Tellus A"; `comus` -> "Comos", which looks
// like a typo in `BUILDING_VARIANTS` itself but is matched as-is since that's the actual dropdown
// option today). `asteroid` (Asteroid_Base) has no variant mapping — its `BUILDING_VARIANTS` list
// (Ice/Metal/Rock) is the belt's resource type, not a construction layout, so Raven Colonial's
// buildType has nothing to map it to.
//
// Known accuracy limitation: Raven Colonial's per-site `buildType` is a fixed identifier per
// building CATEGORY, not necessarily the true in-game layout choice — e.g.
// `rc-jsons/swoilz-aw-c-d52.json`'s "Bianchi Enterprise" site has `buildType: "hestia"`, but the
// real matching facility in the committed `jsons/swoilz-aw-c-d52.json` export is actually the
// "Clotho" layout (a different valid option of the same Civilian_Planetary_Outpost building).
// `variant` is purely cosmetic (never affects stats/costs/solver behavior — see
// `PresentFacilitySlot.variant`'s doc comment) and freely correctable in the dropdown afterward, so
// this table's best-effort guess is used as the default rather than leaving every imported
// facility's variant blank.
export const RC_BUILD_TYPE: Record<string, { building: string; slot: "space" | "ground"; variant?: string }> = {
  aegle: { building: "Civilian_Hub", slot: "ground", variant: "Aegle" },
  aerecura: { building: "Large_Extraction_Settlement", slot: "ground", variant: "Aerecura" },
  aergia: { building: "Small_Tourism_Settlement", slot: "ground", variant: "Aergia" },
  alala: { building: "Military_Hub", slot: "ground", variant: "Alala" },
  alastor: { building: "Military", slot: "space", variant: "Alastor" },
  aletheia: { building: "Communication_Station", slot: "space", variant: "Aletheia" },
  ananke: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Ananke" },
  angelia: { building: "Satellite", slot: "space", variant: "Angelia" },
  annona: { building: "Medium_Agricultural_Settlement", slot: "ground", variant: "Annona" },
  antevorta: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Antevorta" },
  apate: { building: "Pirate_Base", slot: "space", variant: "Apate" },
  aphrodite: { building: "Planetary_Port", slot: "ground", variant: "Aphrodite" },
  apollo: { building: "Orbis_or_Ocellus", slot: "space", variant: "Orbis (Apollo)" },
  ares: { building: "Military_Hub", slot: "ground", variant: "Ares" },
  artemis: { building: "Orbis_or_Ocellus", slot: "space", variant: "Orbis (Artemis)" },
  asclepius: { building: "Medical", slot: "space", variant: "Asclepius" },
  asteria: { building: "Medium_Scientific_Settlement", slot: "ground", variant: "Asteria" },
  asteroid: { building: "Asteroid_Base", slot: "space" },
  astraeus: { building: "Research_Station", slot: "space", variant: "Astraeus" },
  athena: { building: "Scientific_Hub", slot: "ground", variant: "Athena" },
  atropos: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Atropos" },
  bacchus: { building: "Space_Bar", slot: "space", variant: "Bacchus" },
  bellona: { building: "Medium_Military_Settlement", slot: "ground", variant: "Bellona" },
  bia: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Bia" },
  caelus: { building: "Scientific_Hub", slot: "ground", variant: "Caelus" },
  caerus: { building: "Medium_Scientific_Settlement", slot: "ground", variant: "Caerus" },
  ceres: { building: "Large_Agricultural_Settlement", slot: "ground", variant: "Ceres" },
  chronos: { building: "Large_Scientific_Settlement", slot: "ground", variant: "Chronos" },
  clotho: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Clotho" },
  coeus: { building: "Research_Station", slot: "space", variant: "Coeus" },
  comus: { building: "Medium_Tourism_Settlement", slot: "ground", variant: "Comos" },
  consus: { building: "Small_Agricultural_Settlement", slot: "ground", variant: "Consus" },
  dec_truss: { building: "Dodecahedron", slot: "space", variant: "Dec Truss" },
  decima: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Decima" },
  demeter: { building: "Space_Farm", slot: "space", variant: "Demeter" },
  dicaeosyne: { building: "Security_Station", slot: "space", variant: "Dicaeosyne" },
  dione: { building: "Research_Station", slot: "space", variant: "Dione" },
  dionysus: { building: "Space_Bar", slot: "space", variant: "Dionysus" },
  dodec: { building: "Dodecahedron", slot: "space", variant: "No Truss Dodo" },
  dodona: { building: "Research_Station", slot: "space", variant: "Dodona" },
  dual_truss: { building: "Coriolis", slot: "space", variant: "Dual Truss" },
  dysnomia: { building: "Criminal_Outpost", slot: "space", variant: "Dysnomia" },
  eirene: { building: "Satellite", slot: "space", variant: "Eirene" },
  enodia: { building: "Relay_Station", slot: "space", variant: "Enodia" },
  enyo: { building: "Medium_Military_Settlement", slot: "ground", variant: "Enyo" },
  erebus: { building: "Large_Extraction_Settlement", slot: "ground", variant: "Erebus" },
  eunomia: { building: "Security_Station", slot: "space", variant: "Eunomia" },
  eunostus: { building: "Industrial_Hub", slot: "ground", variant: "Eunostus" },
  eupraxia: { building: "Medical", slot: "space", variant: "Eupraxia" },
  euthenia: { building: "Mining_Outpost", slot: "space", variant: "Euthenia" },
  fauna: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Fauna" },
  fontus: { building: "Small_Industrial_Settlement", slot: "ground", variant: "Fontus" },
  fornax: { building: "Large_Agricultural_Settlement", slot: "ground", variant: "Fornax" },
  fufluns: { building: "Large_Tourism_Settlement", slot: "ground", variant: "Fufluns" },
  gaea: { building: "Large_Industrial_Settlement", slot: "ground", variant: "Gaea" },
  gelos: { building: "Medium_Tourism_Settlement", slot: "ground", variant: "Gelos" },
  harmonia: { building: "Government", slot: "space", variant: "Harmonia" },
  hedone: { building: "Tourist", slot: "space", variant: "Hedone" },
  hephaestus: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Hephaestus" },
  hera: { building: "Planetary_Port", slot: "ground", variant: "Hera" },
  hermes: { building: "Satellite", slot: "space", variant: "Hermes" },
  hestia: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Hestia" },
  ichnaea: { building: "Relay_Station", slot: "space", variant: "Ichnaea" },
  io: { building: "Outpost_Hub", slot: "ground", variant: "Io" },
  ioke: { building: "Small_Military_Settlement", slot: "ground", variant: "Ioke" },
  janus: { building: "High_Tech_Hub", slot: "ground", variant: "Janus" },
  lachesis: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Lachesis" },
  laverna: { building: "Pirate_Base", slot: "space", variant: "Laverna" },
  mantus: { building: "Medium_Extraction_Settlement", slot: "ground", variant: "Mantus" },
  mefitis: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Mefitis" },
  meteope: { building: "Medium_Industrial_Settlement", slot: "ground", variant: "Meteope" },
  minerva: { building: "Large_Military_Settlement", slot: "ground", variant: "Minerva" },
  minthe: { building: "Medium_Industrial_Settlement", slot: "ground", variant: "Minthe" },
  molae: { building: "Industrial_Hub", slot: "ground", variant: "Molae" },
  necessitas: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Necessitas" },
  nemesis: { building: "Military_Outpost", slot: "space", variant: "Nemesis" },
  no_truss: { building: "Coriolis", slot: "space", variant: "No Truss" },
  nomos: { building: "Security_Station", slot: "space", variant: "Nomos" },
  nona: { building: "Civilian_Planetary_Outpost", slot: "ground", variant: "Nona" },
  ocellus: { building: "Orbis_or_Ocellus", slot: "space", variant: "Ocellus" },
  opis: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Opis" },
  opora: { building: "Tourist", slot: "space", variant: "Opora" },
  orcus: { building: "Medium_Extraction_Settlement", slot: "ground", variant: "Orcus" },
  ourea: { building: "Small_Extraction_Settlement", slot: "ground", variant: "Ourea" },
  palici: { building: "Medium_Industrial_Settlement", slot: "ground", variant: "Palici" },
  pasithea: { building: "Tourist", slot: "space", variant: "Pasithea" },
  pheobe: { building: "Small_Scientific_Settlement", slot: "ground", variant: "Pheobe" },
  phorcys: { building: "Mining_Outpost", slot: "space", variant: "Phorcys" },
  picumnus: { building: "Medium_Agricultural_Settlement", slot: "ground", variant: "Picumnus" },
  pistis: { building: "Communication_Station", slot: "space", variant: "Pistis" },
  plutus: { building: "Commercial_Outpost", slot: "space", variant: "Plutus" },
  poena: { building: "Security_Station", slot: "space", variant: "Poena" },
  polemos: { building: "Medium_Military_Settlement", slot: "ground", variant: "Polemos" },
  ponos: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Ponos" },
  porrima: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Porrima" },
  poseidon: { building: "Planetary_Port", slot: "ground", variant: "Poseidon" },
  prometheus: { building: "Scientific_Outpost", slot: "space", variant: "Prometheus" },
  providentia: { building: "Scientific_Planetary_Outpost", slot: "ground", variant: "Providentia" },
  quad_truss: { building: "Coriolis", slot: "space", variant: "Quad Truss" },
  quint_truss: { building: "Dodecahedron", slot: "space", variant: "Quint Truss" },
  silenus: { building: "Refinery_Hub", slot: "ground", variant: "Silenus" },
  soter: { building: "Communication_Station", slot: "space", variant: "Soter" },
  tartarus: { building: "Extraction_Hub", slot: "ground", variant: "Tartarus" },
  tellus: { building: "Exploration_Hub", slot: "ground", variant: "Tellus A" },
  tethys: { building: "Industrial_Planetary_Outpost", slot: "ground", variant: "Tethys" },
  vacuna: { building: "Military", slot: "space", variant: "Vacuna" },
  vesta: { building: "Civilian_Outpost", slot: "space", variant: "Vesta" },
  vulcan: { building: "Industrial_Outpost", slot: "space", variant: "Vulcan" },
  zeus: { building: "Planetary_Port", slot: "ground", variant: "Zeus" },
};
