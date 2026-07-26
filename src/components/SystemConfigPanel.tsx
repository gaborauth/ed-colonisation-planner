import { useEffect, useMemo, type Dispatch } from "react";
import { ALL_CATEGORIES, isPort, isPortRole, ALL_BUILDINGS, toPrintable, getBuildingVariants } from "../data/buildings";
import { buildBodyHierarchy, type BodyHierarchyNode } from "../domain/bodyHierarchy";
import { computeCurrentSystemScores } from "../domain/currentSystemScores";
import type { SystemLinksResult } from "../domain/links";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import {
  deriveCurrentPoints,
  derivePresentCounts,
  deriveSlotUsage,
  normalizeFacilitySlots,
  toSlotUsageBodies,
  type PresentFacilitySlot,
} from "../domain/presentFacilities";
import { computePresentSystemLinks, strongLinkedInstances } from "../domain/presentLinks";
import { compareBodyNames, type JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { BodyInfoIcon, facilityEconomyRatios, facilityMarketLinks, FacilityInfoIcon } from "./FacilityInfo";
import { SlotBar } from "./SlotBar";
import { SystemScoresSummary } from "./SystemScoresSummary";

interface SystemConfigPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
  /** Folds this panel once a solve completes — App.tsx passes its `resultState.result` straight
   * through. Reacts to a NEW non-null result object specifically (each successful solve creates a
   * fresh one), not just "is non-null", so re-rendering for an unrelated reason after a solve
   * doesn't keep fighting a user who already manually re-expanded it. */
  justSolved: SolverResult | null;
}

const SLOT_KINDS: { kind: "space" | "ground"; label: string; category: string }[] = [
  { kind: "space", label: "Orbital", category: "Space" },
  { kind: "ground", label: "Ground", category: "Ground" },
];

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
  const economyRatios = facilityEconomyRatios(firstStationBuilding, body, allBodies, linksResult);
  const marketLinks = facilityMarketLinks(firstStationBuilding, body, linksResult);
  return (
    <div className="facility-tree-slot facility-tree-slot-primary">
      <FacilityInfoIcon
        building={firstStationBuilding}
        bodyName={body.bodyName}
        slotLabel={`${label} 1`}
        nickname={firstStationCustomName}
        variant={firstStationVariant}
        economyRatios={economyRatios}
        marketLinks={marketLinks}
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
          const economyRatios = slot ? facilityEconomyRatios(slot.building, body, allBodies, linksResult) : [];
          const marketLinks = slot ? facilityMarketLinks(slot.building, body, linksResult) : [];
          return (
            <div className="facility-tree-slot" key={`${kind}-${index}`}>
              <FacilityInfoIcon
                building={slot?.building}
                bodyName={body.bodyName}
                slotLabel={`${label} ${index + 1}`}
                nickname={slot?.customName}
                variant={slot?.variant}
                economyRatios={economyRatios}
                marketLinks={marketLinks}
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

export function SystemConfigPanel({ formState, dispatch, justSolved }: SystemConfigPanelProps) {
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(false);
  useEffect(() => {
    if (justSolved) setCollapsed(true);
    // setCollapsed has a stable identity (useScrollAnchoredCollapse wraps it in useCallback([])) —
    // listed here only to satisfy exhaustive-deps, doesn't change when this effect actually reruns.
  }, [justSolved, setCollapsed]);

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

  // "The actual sum of values of the system" (moved in from the old standalone Result panel,
  // 2026-07-26) — the CURRENT, already-built system's totals, computed directly (no MILP: nothing
  // to optimize for a fixed layout) via domain/currentSystemScores.ts. Falls back to the flat
  // `alreadyPresent` map in aggregate mode, same source BuildingsTable.tsx already uses there —
  // this panel's own tree only exists in per-body mode.
  const presentCounts = hasBodies ? derivePresentCounts(slotUsageBodies) : formState.alreadyPresent;
  const currentScores = computeCurrentSystemScores(presentCounts, formState.firstStationBuilding);
  const currentPoints = deriveCurrentPoints(slotUsageBodies, formState.firstStationBuilding);

  return (
    <section id="system-panel" className={`panel${locked ? " panel-unconfigured" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">Actual facilities in the system</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && (
        <>
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

      <SystemScoresSummary
        scores={currentScores}
        includeEconomySynergy={false}
        extraFields={[
          { label: "T2 points", value: currentPoints.t2 },
          { label: "T3 points", value: currentPoints.t3 },
        ]}
      />

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
        </>
      )}
    </section>
  );
}
