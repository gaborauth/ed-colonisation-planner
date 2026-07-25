import { useMemo, type Dispatch, type ReactNode } from "react";
import {
  ALL_CATEGORIES,
  BASE_SCORES,
  FACILITY_ECONOMY_GUESS,
  isPort,
  isPortRole,
  ALL_BUILDINGS,
  toPrintable,
  getBuildingVariants,
  type EconomyType,
} from "../data/buildings";
import { buildBodyHierarchy, type BodyHierarchyNode } from "../domain/bodyHierarchy";
import {
  computeBodyEconomyOverrides,
  computeColonyEconomyBreakdown,
  computeEconomyRatios,
  computeStrongLinkBreakdown,
  hasGeologicals,
  hasOrganics,
  hasRings,
  hasVolcanism,
  isTerraformable,
  isTidalLockChainToStar,
  TERRAFORMABLE_AGRICULTURE_BUG_LINK,
  TERRAFORMABLE_AGRICULTURE_BUG_NOTE,
  type EconomyBreakdown,
  type EconomyRatio,
} from "../domain/economyOverrides";
import type { SystemLinksResult } from "../domain/links";
import { deriveSlotUsage, normalizeFacilitySlots, toSlotUsageBodies, type PresentFacilitySlot } from "../domain/presentFacilities";
import { computePresentSystemLinks, strongLinkedInstances, type StrongLinkedInstance } from "../domain/presentLinks";
import { compareBodyNames, type JournalBody } from "../journal/parser";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { SlotBar } from "./SlotBar";
import { Tooltip } from "./Tooltip";

interface SystemConfigPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

const SLOT_KINDS: { kind: "space" | "ground"; label: string; category: string }[] = [
  { kind: "space", label: "Orbital", category: "Space" },
  { kind: "ground", label: "Ground", category: "Ground" },
];

/** A facility/port's own base economy type(s), before any body-feature boost/decrease is applied —
 * a port's `computeBodyEconomyOverrides(body).economies` (defaulting to `["Colony"]` when empty,
 * same convention `LinksPanel.tsx` already uses for display), or a supporting facility's single
 * `FACILITY_ECONOMY_GUESS` entry (empty for a deliberately-unmapped building — see that constant's
 * header comment — which correctly omits the Economy Ratios section entirely for those). */
function facilityBaseEconomies(building: string, body: JournalBody): EconomyType[] {
  if (isPortRole(building)) {
    const economies = computeBodyEconomyOverrides(body).economies;
    return economies.length > 0 ? economies : ["Colony"];
  }
  return FACILITY_ECONOMY_GUESS[building] ?? [];
}

interface FacilityInfoProps {
  building: string;
  bodyName: string;
  slotLabel: string;
  nickname: string | undefined;
  variant: string | undefined;
  economyRatios: EconomyRatio[];
  strongLinks: StrongLinkedInstance[];
}

/** Hover-box body for `FacilityInfoIcon` below: a "Basic data" block (nickname/build type/body/
 * slot/status — status is always "Built", since this panel only ever shows already-built
 * facilities), an "Economy ratios" block (body-driven only — see `facilityBaseEconomies`/
 * `computeEconomyRatios`; no strong/weak link contribution folded in yet, a deliberately deferred
 * follow-up), a "Strong market link(s)" block (only for ports — see `strongLinkedInstances`; the
 * header itself is singular/plural/absent depending on the count), and a "System effects and haul"
 * block (this building's non-zero score contributions, T2/T3 point cost, and construction cost
 * standing in for "haul" — no real commodity/tonnage model exists, see CLAUDE.md's scope
 * boundaries). */
function facilityInfoContent({
  building: name,
  bodyName,
  slotLabel,
  nickname,
  variant,
  economyRatios,
  strongLinks,
}: FacilityInfoProps) {
  const building = ALL_BUILDINGS[name];
  const statLines = BASE_SCORES.filter((score) => score !== "construction_cost" && building[score] !== 0).map(
    (score) => (
      <div key={score}>
        {toPrintable(score)}: {building[score] >= 0 ? "+" : ""}
        {building[score]}
      </div>
    ),
  );
  return (
    <>
      <div className="facility-info-section-header">Basic data</div>
      <div>
        <strong>{nickname ?? "— no nickname —"}</strong>
      </div>
      <div>
        Build type: {toPrintable(name)}
        {variant ? ` (${variant})` : ""}
      </div>
      <div>Body: {bodyName}</div>
      <div>Slot: {slotLabel}</div>
      <div>Status: Built</div>
      {economyRatios.length > 0 && (
        <>
          <div className="facility-info-section-header">Economy ratios</div>
          {economyRatios.map((r) => (
            <div key={r.economy}>
              {r.economy}: {r.percent}%
            </div>
          ))}
        </>
      )}
      {strongLinks.length > 0 && (
        <>
          <div className="facility-info-section-header">
            {strongLinks.length === 1 ? "Strong market link" : "Strong market links"}
          </div>
          {strongLinks.map((link, i) => (
            <div key={i}>{link.nickname ? `${link.nickname} — ${toPrintable(link.building)}` : toPrintable(link.building)}</div>
          ))}
        </>
      )}
      <div className="facility-info-section-header">System effects and haul</div>
      {statLines}
      <div>
        T2: {building.T2points === "port" ? "escalating (port)" : building.T2points}
        {" · "}
        T3: {building.T3points === "port" ? "escalating (port)" : building.T3points}
      </div>
      <div>Haul (cost): {building.construction_cost.toLocaleString()} Cm</div>
    </>
  );
}

/** The "i" icon shown before every slot's label (see `facility-tree-slot-label` usages below) —
 * hoverable with a `Tooltip` summarizing the building actually built there when the slot isn't
 * empty, greyed out and inert for an empty slot (nothing to show). */
function FacilityInfoIcon({
  building,
  bodyName,
  slotLabel,
  nickname,
  variant,
  economyRatios,
  strongLinks,
}: {
  building: string | undefined;
  bodyName: string;
  slotLabel: string;
  nickname: string | undefined;
  variant: string | undefined;
  economyRatios: EconomyRatio[];
  strongLinks: StrongLinkedInstance[];
}) {
  if (!building) {
    return (
      <span className="facility-info-icon facility-info-icon-empty" aria-hidden="true">
        ⓘ
      </span>
    );
  }
  return (
    <Tooltip
      content={facilityInfoContent({ building, bodyName, slotLabel, nickname, variant, economyRatios, strongLinks })}
      pinnable
    >
      <span className="facility-info-icon" aria-label={`${toPrintable(building)} info`}>
        ⓘ
      </span>
    </Tooltip>
  );
}

/** "Rocky body" / "Water world" / etc. for a planet (its `planetClass` verbatim); a star has no
 * `planetClass` at all, so falls back to its `starType` (e.g. "F-type star"), or a bare "Star" if
 * even that's missing. `undefined` only for a planet whose class was never recorded. */
function bodyTypeLabel(body: JournalBody): string | undefined {
  if (body.kind === "star") return body.starType ? `${body.starType}-type star` : "Star";
  return body.planetClass;
}

const METERS_PER_SECOND_SQUARED_PER_G = 9.80665;

/** Shared Economy/Value/Effects table markup for both the "Default economies" and "Strong links"
 * hover-box blocks below — same per-economy row-grouping (one `rowSpan`'d Economy cell per block,
 * one row per contributing line) and running-total display, just fed a different `EconomyBreakdown[]`. */
function economyBreakdownTable(breakdown: EconomyBreakdown[]) {
  return (
    <table className="facility-body-info-table">
      <thead>
        <tr>
          <th>Economy</th>
          <th>Value</th>
          <th>Effects</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.flatMap((block) => {
          let runningTotal = 0;
          return block.lines.map((line, i) => {
            runningTotal += line.amount;
            const isLast = i === block.lines.length - 1;
            return (
              <tr key={`${block.economy}-${i}`}>
                {i === 0 && <td rowSpan={block.lines.length}>{block.economy}</td>}
                <td className="facility-body-info-value">
                  {line.amount >= 0 ? "+" : ""}
                  {line.amount.toFixed(2)}
                  {isLast && <> = {runningTotal.toFixed(2)}</>}
                </td>
                <td>{line.label}</td>
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

/** Hover-box body for `BodyInfoIcon` below — a body's own physical stats and, separately, the
 * economy breakdown a hypothetical Colony-type port there would start with (independent of
 * whatever's actually built at this body, if anything — see `computeColonyEconomyBreakdown`), and
 * the strong-link boost/decrease modifiers ANY strong link at this body would receive (see
 * `computeStrongLinkBreakdown`) — the latter is body-driven only, same as the former, and doesn't
 * require a port/facility to actually be built here yet. A Terraformable body additionally gets a
 * one-line disclaimer + link to `public/known-issues.html` (see `TERRAFORMABLE_AGRICULTURE_BUG_NOTE`/
 * `TERRAFORMABLE_AGRICULTURE_BUG_LINK`) explaining why neither table below includes the +0.40
 * Agriculture boost the source tables document for it — kept short since the hover bubble doesn't
 * wrap text (`Tooltip.css`), full explanation lives on that separate page instead. */
function bodyInfoContent(body: JournalBody, allBodies: JournalBody[]) {
  const basicInfoParts: string[] = [];
  const typeLabel = bodyTypeLabel(body);
  if (typeLabel) basicInfoParts.push(typeLabel);
  const distance = body.raw.DistanceFromArrivalLS;
  if (typeof distance === "number") basicInfoParts.push(`Arrival: ~${distance.toFixed(1)} ls`);
  if (body.surfaceTemperature !== undefined) basicInfoParts.push(`Surface temp: ${body.surfaceTemperature.toFixed(1)} K`);
  if (body.surfaceGravity !== undefined) {
    basicInfoParts.push(`Gravity: ${(body.surfaceGravity / METERS_PER_SECOND_SQUARED_PER_G).toFixed(2)} g`);
  }

  const features: ReactNode[] = [];
  if (body.landable) features.push("Landable");
  if (body.atmosphere) features.push(`Atmosphere: ${body.atmosphere}`);
  if (hasRings(body)) features.push("Rings");
  if (isTerraformable(body)) features.push("Terraformable");
  if (body.tidalLocked === true) {
    // Tidally locked is a real, standalone fact about this body — but the Agriculture strong-link
    // decrease only fires when the WHOLE chain up to the star is tidally locked (see
    // isTidalLockChainToStar's own doc comment), so a body that's locked but sits under an unlocked
    // ancestor gets the label crossed out: true, but functionally inert for that game mechanic.
    const allBodiesById = new Map(allBodies.map((b) => [b.bodyId, b]));
    const decreaseApplies = isTidalLockChainToStar(body, allBodiesById);
    features.push(
      decreaseApplies ? (
        "Tidally locked"
      ) : (
        <s title="Tidally locked, but a body further up the chain to the star isn't — the Agriculture strong-link decrease doesn't apply">
          Tidally locked
        </s>
      ),
    );
  }
  if (hasOrganics(body) === true) features.push("Bio Signals");
  if (hasGeologicals(body) === true) features.push("Geo Signals");
  if (hasVolcanism(body) === true) features.push("Volcanism");

  const breakdown = computeColonyEconomyBreakdown(body, allBodies);
  const strongLinkBreakdown = computeStrongLinkBreakdown(body, allBodies);

  return (
    <>
      <div>
        <strong>{body.bodyName}</strong>
      </div>
      {basicInfoParts.length > 0 && <div>{basicInfoParts.join(" — ")}</div>}
      <div>
        Orbital: {body.slots?.space ?? 0} Ground: {body.slots?.ground ?? 0}
      </div>
      {features.length > 0 && (
        <div>
          {features.map((feature, i) => (
            <span key={i}>
              {i > 0 && "; "}
              {feature}
            </span>
          ))}
        </div>
      )}
      {isTerraformable(body) && (
        <div className="facility-body-info-disclaimer">
          ⚠ {TERRAFORMABLE_AGRICULTURE_BUG_NOTE}{" "}
          <a href={TERRAFORMABLE_AGRICULTURE_BUG_LINK} target="_blank" rel="noreferrer">
            Known issues
          </a>
        </div>
      )}
      {breakdown.length > 0 && (
        <>
          <div className="facility-info-section-header">Default economies</div>
          <div className="facility-body-info-disclaimer">Ports with a "Colony" economy will start with the following:</div>
          {economyBreakdownTable(breakdown)}
        </>
      )}
      {strongLinkBreakdown.length > 0 && (
        <>
          <div className="facility-info-section-header">Strong links</div>
          <div className="facility-body-info-disclaimer">Any strong link formed at this body will receive:</div>
          {economyBreakdownTable(strongLinkBreakdown)}
        </>
      )}
    </>
  );
}

/** The "i" icon shown before every body's name in the tree (the star included) — hoverable with a
 * `Tooltip` summarizing that body's own physical stats and its Colony-economy breakdown. Unlike
 * `FacilityInfoIcon`, this is never greyed/inert — every scanned body has at least a name and
 * (usually) some basic stats to show. */
function BodyInfoIcon({ body, allBodies }: { body: JournalBody; allBodies: JournalBody[] }) {
  return (
    <Tooltip content={bodyInfoContent(body, allBodies)} pinnable>
      <span className="facility-info-icon" aria-label={`${body.bodyName} info`}>
        ⓘ
      </span>
    </Tooltip>
  );
}

interface PrimaryStationFieldsProps {
  firstStationBuilding: string;
  firstStationVariant: string | undefined;
  firstStationCustomName: string | undefined;
  locked: boolean;
  dispatch: Dispatch<PlannerAction>;
}

/** The same design-variant `<select>` + nickname `<input>` pair `BodySlotLeaves` renders for an
 * ordinary already-built facility (see there), reused here for the primary station — its building
 * type is fixed/disabled (chosen via the "Primary station" field above, not editable in the tree),
 * but the cosmetic variant/nickname fields are still freely editable. Shared by both
 * `PrimaryStationLeaf` (unassigned) and `PrimaryStationSlotLeaf` (assigned to a body) below so the
 * two don't duplicate this markup. */
function PrimaryStationFields({
  firstStationBuilding,
  firstStationVariant,
  firstStationCustomName,
  locked,
  dispatch,
}: PrimaryStationFieldsProps) {
  const variants = getBuildingVariants(firstStationBuilding);
  return (
    <>
      {variants && (
        <select
          className="facility-tree-variant"
          aria-label="Primary station design variant"
          value={firstStationVariant ?? (variants.length === 1 ? variants[0] : "")}
          disabled={locked || variants.length === 1}
          onChange={(e) =>
            dispatch({
              type: "patch",
              patch: { firstStationVariant: e.target.value === "" ? undefined : e.target.value },
            })
          }
        >
          {variants.length > 1 && <option value="">— design —</option>}
          {variants.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        className="facility-tree-name"
        aria-label="Primary station nickname"
        placeholder="Nickname (optional)"
        value={firstStationCustomName ?? ""}
        disabled={locked}
        onChange={(e) =>
          dispatch({
            type: "patch",
            patch: { firstStationCustomName: e.target.value === "" ? undefined : e.target.value },
          })
        }
      />
    </>
  );
}

/** The primary station shown as an immutable leaf, used only while it's picked but not yet
 * assigned to a body — once assigned, it occupies that body's first orbital slot instead (see
 * `BodySlotLeaves`'s `PrimaryStationSlotLeaf` below), consistent with it now actually consuming
 * real orbital capacity rather than floating in its own dedicated slot. */
function PrimaryStationLeaf({
  firstStationBuilding,
  firstStationVariant,
  firstStationCustomName,
  locked,
  dispatch,
}: PrimaryStationFieldsProps) {
  return (
    <div className="facility-tree-slot">
      <span className="facility-tree-slot-label">Primary station</span>
      <select aria-label="Primary station (set above)" value={firstStationBuilding} disabled>
        <option value={firstStationBuilding}>{toPrintable(firstStationBuilding)}</option>
      </select>
      <PrimaryStationFields
        firstStationBuilding={firstStationBuilding}
        firstStationVariant={firstStationVariant}
        firstStationCustomName={firstStationCustomName}
        locked={locked}
        dispatch={dispatch}
      />
    </div>
  );
}

/** The primary station rendered as the body's actual first orbital slot — fixed/disabled like an
 * ordinary present port (never demolishable), marked with a ★ badge so it reads as distinct from
 * a regular already-built facility. Physically slot "Orbital 1"; the solver reserves it (see
 * `solve.ts`'s `firstStationReservation`), so `BodySlotLeaves` never offers it for editing and
 * ordinary orbital slots on this body start numbering from 2. */
function PrimaryStationSlotLeaf({
  label,
  body,
  allBodies,
  linksResult,
  firstStationBuilding,
  firstStationVariant,
  firstStationCustomName,
  locked,
  dispatch,
}: PrimaryStationFieldsProps & {
  label: string;
  body: JournalBody;
  allBodies: JournalBody[];
  linksResult: SystemLinksResult;
}) {
  const strongLinks = isPortRole(firstStationBuilding) ? strongLinkedInstances(linksResult, body, firstStationBuilding) : [];
  const economyRatios = computeEconomyRatios(facilityBaseEconomies(firstStationBuilding, body), body, allBodies);
  return (
    <div className="facility-tree-slot facility-tree-slot-primary">
      <FacilityInfoIcon
        building={firstStationBuilding}
        bodyName={body.bodyName}
        slotLabel={`${label} 1`}
        nickname={firstStationCustomName}
        variant={firstStationVariant}
        economyRatios={economyRatios}
        strongLinks={strongLinks}
      />
      <span className="facility-tree-slot-label">
        {label} 1
      </span>
      <select aria-label={`Primary station (${label} 1, set above)`} value={firstStationBuilding} disabled>
        <option value={firstStationBuilding}>{toPrintable(firstStationBuilding)}</option>
      </select>
      <PrimaryStationFields
        firstStationBuilding={firstStationBuilding}
        firstStationVariant={firstStationVariant}
        firstStationCustomName={firstStationCustomName}
        locked={locked}
        dispatch={dispatch}
      />
      <span className="primary-badge" aria-hidden="true" title="Primary/claim station">
        ★
      </span>
    </div>
  );
}

interface BodySlotLeavesProps {
  body: JournalBody;
  locked: boolean;
  dispatch: Dispatch<PlannerAction>;
  /** Set when this body is the primary station's assigned body — reserves this body's first
   * orbital slot for it (see `PrimaryStationSlotLeaf` above) instead of offering it as an ordinary
   * editable slot. */
  isFirstStationBody: boolean;
  firstStationBuilding: string;
  firstStationVariant: string | undefined;
  firstStationCustomName: string | undefined;
  linksResult: SystemLinksResult;
  allBodies: JournalBody[];
}

/** A scanned body's own leaves: one per physical orbital/ground slot, each a dropdown for what's
 * already built there (filtered to that slot kind's buildings), plus a "Demolishable" checkbox
 * once a facility is picked (hidden entirely for an empty slot — nothing to demolish). Ports are
 * never demolishable in this app (see domain/presentFacilities.ts's header) — the checkbox is
 * shown but disabled for them so the user understands why, rather than silently doing nothing. */
function BodySlotLeaves({
  body,
  locked,
  dispatch,
  isFirstStationBody,
  firstStationBuilding,
  firstStationVariant,
  firstStationCustomName,
  linksResult,
  allBodies,
}: BodySlotLeavesProps) {
  function setSlot(kind: "space" | "ground", index: number, slot: PresentFacilitySlot | null): void {
    dispatch({ type: "setFacilitySlot", bodyId: body.bodyId, kind, index, slot });
  }

  return (
    <>
      {SLOT_KINDS.flatMap(({ kind, label, category }) => {
        const count = body.slots?.[kind] ?? 0;
        const slots = normalizeFacilitySlots(body.presentFacilities?.[kind], count);
        // The primary station's own reservation is only ever the first *orbital* slot (it's always
        // an orbital Port-role building, see SolverInput.firstStationBuilding) — ground slots are
        // never affected, and this body's index 0 space slot is expected to stay empty in
        // `presentFacilities` (the reservation is tracked flatly in the solver, not as a present
        // facility entry) even though it's no longer offered here for editing.
        const reserveFirstForPrimary = kind === "space" && isFirstStationBody && count > 0;
        const editableSlots = reserveFirstForPrimary ? slots.slice(1) : slots;
        const leaves = editableSlots.map((slot, i) => {
          const index = reserveFirstForPrimary ? i + 1 : i;
          const building = slot ? ALL_BUILDINGS[slot.building] : undefined;
          const buildingIsPort = building ? isPort(building) : false;
          const variants = slot ? getBuildingVariants(slot.building) : undefined;
          const strongLinks = slot && isPortRole(slot.building) ? strongLinkedInstances(linksResult, body, slot.building) : [];
          const economyRatios = slot ? computeEconomyRatios(facilityBaseEconomies(slot.building, body), body, allBodies) : [];
          return (
            <div className="facility-tree-slot" key={`${kind}-${index}`}>
              <FacilityInfoIcon
                building={slot?.building}
                bodyName={body.bodyName}
                slotLabel={`${label} ${index + 1}`}
                nickname={slot?.customName}
                variant={slot?.variant}
                economyRatios={economyRatios}
                strongLinks={strongLinks}
              />
              <span className="facility-tree-slot-label">
                {label} {index + 1}
              </span>
              <select
                aria-label={`${body.bodyName} ${label} slot ${index + 1} facility`}
                value={slot?.building ?? ""}
                disabled={locked}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    setSlot(kind, index, null);
                    return;
                  }
                  // Auto-pick the single option when the newly-selected building has only one
                  // known design variant (see `variants` below) — nothing else to choose from, so
                  // don't make the user open a second dropdown just to confirm it.
                  const newVariants = getBuildingVariants(value);
                  setSlot(kind, index, {
                    building: value,
                    demolishable: slot?.demolishable ?? false,
                    customName: slot?.customName,
                    variant: newVariants?.length === 1 ? newVariants[0] : undefined,
                  });
                }}
              >
                <option value="">— empty —</option>
                {ALL_CATEGORIES[category].map((name) => (
                  <option key={name} value={name}>
                    {toPrintable(name)}
                  </option>
                ))}
              </select>
              {slot && variants && (
                <select
                  className="facility-tree-variant"
                  aria-label={`${body.bodyName} ${label} slot ${index + 1} design variant`}
                  // Falls back to the single option when there's only one — covers data saved
                  // before this auto-pick existed (see the facility select's onChange above),
                  // not just freshly-picked buildings.
                  value={slot.variant ?? (variants.length === 1 ? variants[0] : "")}
                  disabled={locked || variants.length === 1}
                  onChange={(e) => setSlot(kind, index, { ...slot, variant: e.target.value === "" ? undefined : e.target.value })}
                >
                  {variants.length > 1 && <option value="">— design —</option>}
                  {variants.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
              {slot && (
                <input
                  type="text"
                  className="facility-tree-name"
                  aria-label={`${body.bodyName} ${label} slot ${index + 1} nickname`}
                  placeholder="Nickname (optional)"
                  value={slot.customName ?? ""}
                  disabled={locked}
                  onChange={(e) => setSlot(kind, index, { ...slot, customName: e.target.value === "" ? undefined : e.target.value })}
                />
              )}
              {slot && (
                <label
                  className="facility-tree-demolish"
                  title={buildingIsPort ? "Ports can't be demolished in this tool" : undefined}
                >
                  <input
                    type="checkbox"
                    aria-label={`${body.bodyName} ${label} slot ${index + 1} demolishable`}
                    checked={slot.demolishable}
                    disabled={locked || buildingIsPort}
                    onChange={(e) => setSlot(kind, index, { ...slot, demolishable: e.target.checked })}
                  />
                  Demolishable
                </label>
              )}
            </div>
          );
        });
        if (reserveFirstForPrimary) {
          leaves.unshift(
            <PrimaryStationSlotLeaf
              key={`${kind}-primary`}
              label={label}
              body={body}
              allBodies={allBodies}
              linksResult={linksResult}
              firstStationBuilding={firstStationBuilding}
              firstStationVariant={firstStationVariant}
              firstStationCustomName={firstStationCustomName}
              locked={locked}
              dispatch={dispatch}
            />,
          );
        }
        return leaves;
      })}
    </>
  );
}

interface HierarchyBranchProps {
  node: BodyHierarchyNode;
  starSystem: string;
  firstStationBodyId: number | undefined;
  firstStationBuilding: string;
  firstStationVariant: string | undefined;
  firstStationCustomName: string | undefined;
  locked: boolean;
  dispatch: Dispatch<PlannerAction>;
  linksResult: SystemLinksResult;
  allBodies: JournalBody[];
}

/** One level of the star/planet/moon/sub-moon hierarchy (see domain/bodyHierarchy.ts) — a branch
 * per level, indented further at each level via nested `.facility-tree-body` divs. `node.body` is
 * null for a level that was never itself scanned (only exists to group its descendants), which
 * renders just the heading with no slot leaves. The heading always shows the body's full name
 * (with the system name prefix, e.g. "Swoilz AW-C d52 B 10 e a") rather than just the trailing
 * "e"/"a"-style segment — a scanned body's own name is used verbatim; a synthetic (never scanned)
 * node's full name is reconstructed from the system name + its cumulative path. */
function HierarchyBranch({
  node,
  starSystem,
  firstStationBodyId,
  firstStationBuilding,
  firstStationVariant,
  firstStationCustomName,
  locked,
  dispatch,
  linksResult,
  allBodies,
}: HierarchyBranchProps) {
  const isFirstStationBody = node.body?.bodyId === firstStationBodyId;
  const fullName = node.body?.bodyName ?? `${starSystem} ${node.path}`;
  return (
    <div className="facility-tree-body">
      <div className="facility-tree-body-name">
        {node.body && <BodyInfoIcon body={node.body} allBodies={allBodies} />}
        {fullName}
      </div>
      {node.body && (
        <BodySlotLeaves
          body={node.body}
          locked={locked}
          dispatch={dispatch}
          isFirstStationBody={isFirstStationBody}
          firstStationBuilding={firstStationBuilding}
          firstStationVariant={firstStationVariant}
          firstStationCustomName={firstStationCustomName}
          linksResult={linksResult}
          allBodies={allBodies}
        />
      )}
      {node.children.map((child) => (
        <HierarchyBranch
          key={child.path}
          node={child}
          starSystem={starSystem}
          firstStationBodyId={firstStationBodyId}
          firstStationBuilding={firstStationBuilding}
          firstStationVariant={firstStationVariant}
          firstStationCustomName={firstStationCustomName}
          locked={locked}
          dispatch={dispatch}
          linksResult={linksResult}
          allBodies={allBodies}
        />
      ))}
    </div>
  );
}

export function SystemConfigPanel({ formState, dispatch }: SystemConfigPanelProps) {
  // Only meaningful once a per-body layout is applied (see JournalImportPanel); in aggregate mode
  // there's no per-body ring-eligibility data to check, so this never disables anything there.
  const hasBodies = formState.bodies.length > 0;
  const ringEligibleBodyIds = new Set(
    formState.bodies.filter((b) => (b.slots?.asteroid ?? 0) > 0).map((b) => b.bodyId),
  );
  const noRingEligibleBody = hasBodies && ringEligibleBodyIds.size === 0;
  // The primary station always occupies one of its body's orbital slots (see solve.ts), so it can
  // only ever be assigned to a body that has at least one — same idea as the Asteroid_Base
  // ring-eligibility filter below, just unconditional instead of building-specific.
  const orbitalEligibleBodies = formState.bodies.filter((b) => (b.slots?.space ?? 0) > 0);
  const stationBodyOptions = (
    formState.firstStationBuilding === "Asteroid_Base"
      ? orbitalEligibleBodies.filter((b) => ringEligibleBodyIds.has(b.bodyId))
      : orbitalEligibleBodies
  )
    .slice()
    .sort(compareBodyNames);

  // Locked (disabled + greyed) until a journal body layout is applied (see JournalImportPanel).
  // `systemConfigured` lives in formState itself (not local component state) specifically so a
  // `reset` re-locks it automatically.
  const locked = !formState.systemConfigured;

  // Link topology for what's actually built today (see domain/presentLinks.ts) — feeds the
  // "Strong market link(s)" hover section below. Recomputed only when the underlying present-
  // facility/primary-station state actually changes, not on every render.
  const linksResult = useMemo(
    () =>
      computePresentSystemLinks(
        formState.bodies,
        formState.firstStationBuilding && formState.firstStationBodyId !== undefined
          ? { building: formState.firstStationBuilding, bodyId: formState.firstStationBodyId }
          : undefined,
      ),
    [formState.bodies, formState.firstStationBuilding, formState.firstStationBodyId],
  );

  // The primary station shows up as a leaf under whichever body it's assigned to (see
  // HierarchyBranch/the root's own leaves below) — but if it's been picked without a body
  // assignment yet, it still needs to be visible somewhere in the tree, so it floats directly
  // under the system root instead.
  const primaryStationUnassigned =
    hasBodies && formState.firstStationBuilding && formState.firstStationBodyId === undefined;

  const hierarchyRoot = hasBodies ? buildBodyHierarchy(formState.starSystem, formState.bodies) : null;

  // Built/free counts derived from the manually-filled facilities tree below (not editable here —
  // these are a read-only summary of it). Asteroid-eligible slots are a subset of orbital slots
  // (an ordinary orbital slot on a ring-eligible body), not a separate pool — see
  // `deriveSlotUsage`'s doc comment — so they're shown nested under "Orbital slots" rather than as
  // a third sibling field.
  const slotUsageBodies = toSlotUsageBodies(formState.bodies);
  const slotUsage = deriveSlotUsage(slotUsageBodies, formState.slots, formState.firstStationBodyId);

  return (
    <section id="system-panel" className={`panel${locked ? " panel-unconfigured" : ""}`}>
      <div className="panel-header">
        <h2>Actual facilities in the system</h2>
      </div>
      <div className="row-grid">
        <div className="field">
          <label>Orbital slots</label>
          <div className="slot-usage">
            <div className="slot-usage-main">
              <SlotBar built={slotUsage.space.built} total={slotUsage.space.total} />
              {slotUsage.space.built} built / {slotUsage.space.free} free
              <span className="slot-usage-total"> of {slotUsage.space.total}</span>
            </div>
            <div className="slot-usage-sub">
              <SlotBar built={slotUsage.asteroidEligibleSpace.built} total={slotUsage.asteroidEligibleSpace.total} />
              ↳ Asteroid-eligible: {slotUsage.asteroidEligibleSpace.built} built /{" "}
              {slotUsage.asteroidEligibleSpace.free} free
              <span className="slot-usage-total"> of {slotUsage.asteroidEligibleSpace.total}</span>
            </div>
          </div>
        </div>
        <div className="field">
          <label>Ground slots</label>
          <div className="slot-usage">
            <div className="slot-usage-main">
              <SlotBar built={slotUsage.ground.built} total={slotUsage.ground.total} />
              {slotUsage.ground.built} built / {slotUsage.ground.free} free
              <span className="slot-usage-total"> of {slotUsage.ground.total}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="row-grid" style={{ marginTop: 14 }}>
        <div className="field">
          <label htmlFor="first-station-building">Primary station *</label>
          <select
            id="first-station-building"
            aria-required="true"
            value={formState.firstStationBuilding}
            disabled={locked}
            onChange={(e) => {
              const building = e.target.value;
              // Auto-pick the single option when the newly-chosen building has only one known
              // design variant — same reasoning as the ordinary facility-slot picker above.
              const newVariants = getBuildingVariants(building);
              dispatch({
                type: "patch",
                patch: {
                  firstStationBuilding: building,
                  firstStationVariant: newVariants?.length === 1 ? newVariants[0] : undefined,
                },
              });
            }}
          >
            <option value="">— select —</option>
            {ALL_CATEGORIES["First Station"].map((name) => {
              const disabledByNoRing = name === "Asteroid_Base" && noRingEligibleBody;
              return (
                <option key={name} value={name} disabled={disabledByNoRing}>
                  {toPrintable(name)}
                  {disabledByNoRing ? " (no ring-eligible body)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        {hasBodies && (
          <div className="field">
            <label htmlFor="first-station-body">On body</label>
            <select
              id="first-station-body"
              value={formState.firstStationBodyId ?? ""}
              disabled={locked}
              onChange={(e) =>
                dispatch({
                  type: "patch",
                  patch: { firstStationBodyId: e.target.value === "" ? undefined : Number(e.target.value) },
                })
              }
            >
              <option value="">— unassigned —</option>
              {stationBodyOptions.map((b) => (
                <option key={b.bodyId} value={b.bodyId}>
                  {b.bodyName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {hierarchyRoot && (
        <div className="facility-tree">
          <div className="facility-tree-root">
            {hierarchyRoot.body && <BodyInfoIcon body={hierarchyRoot.body} allBodies={formState.bodies} />}
            {formState.starSystem || "System"}
          </div>
          {primaryStationUnassigned && (
            <PrimaryStationLeaf
              firstStationBuilding={formState.firstStationBuilding}
              firstStationVariant={formState.firstStationVariant}
              firstStationCustomName={formState.firstStationCustomName}
              locked={locked}
              dispatch={dispatch}
            />
          )}
          {hierarchyRoot.body && (
            <div className="facility-tree-body">
              <BodySlotLeaves
                body={hierarchyRoot.body}
                locked={locked}
                dispatch={dispatch}
                isFirstStationBody={formState.firstStationBodyId === hierarchyRoot.body.bodyId}
                firstStationBuilding={formState.firstStationBuilding}
                firstStationVariant={formState.firstStationVariant}
                firstStationCustomName={formState.firstStationCustomName}
                linksResult={linksResult}
                allBodies={formState.bodies}
              />
            </div>
          )}
          {hierarchyRoot.children.map((child) => (
            <HierarchyBranch
              key={child.path}
              node={child}
              starSystem={formState.starSystem}
              firstStationBodyId={formState.firstStationBodyId}
              firstStationBuilding={formState.firstStationBuilding}
              firstStationVariant={formState.firstStationVariant}
              firstStationCustomName={formState.firstStationCustomName}
              locked={locked}
              dispatch={dispatch}
              linksResult={linksResult}
              allBodies={formState.bodies}
            />
          ))}
        </div>
      )}
    </section>
  );
}
