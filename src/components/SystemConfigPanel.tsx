import type { Dispatch } from "react";
import { ALL_CATEGORIES, isPort, ALL_BUILDINGS, toPrintable } from "../data/buildings";
import { buildBodyHierarchy, type BodyHierarchyNode } from "../domain/bodyHierarchy";
import { normalizeFacilitySlots, type PresentFacilitySlot } from "../domain/presentFacilities";
import { compareBodyNames, type JournalBody } from "../journal/parser";
import { saveSystem } from "../persistence/journalSystems";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

interface SystemConfigPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

const SLOT_KINDS: { kind: "space" | "ground"; label: string; category: string }[] = [
  { kind: "space", label: "Orbital", category: "Space" },
  { kind: "ground", label: "Ground", category: "Ground" },
];

/** The primary station shown as an immutable leaf of the tree — its own dropdown ("Primary
 * station" above) and body assignment ("On body" above) are the actual controls; this is a
 * read-only mirror so the tree shows the complete picture of what's on each body. No demolishable
 * control at all (unlike ordinary slots, which show one disabled for a port) — the primary/claim
 * station can never be demolished, full stop, so there's nothing to show. */
function PrimaryStationLeaf({ firstStationBuilding }: { firstStationBuilding: string }) {
  return (
    <div className="facility-tree-slot">
      <span className="facility-tree-slot-label">Primary station</span>
      <select aria-label="Primary station (set above)" value={firstStationBuilding} disabled>
        <option value={firstStationBuilding}>{toPrintable(firstStationBuilding)}</option>
      </select>
    </div>
  );
}

interface BodySlotLeavesProps {
  body: JournalBody;
  locked: boolean;
  dispatch: Dispatch<PlannerAction>;
}

/** A scanned body's own leaves: one per physical orbital/ground slot, each a dropdown for what's
 * already built there (filtered to that slot kind's buildings), plus a "Demolishable" checkbox
 * once a facility is picked (hidden entirely for an empty slot — nothing to demolish). Ports are
 * never demolishable in this app (see domain/presentFacilities.ts's header) — the checkbox is
 * shown but disabled for them so the user understands why, rather than silently doing nothing. */
function BodySlotLeaves({ body, locked, dispatch }: BodySlotLeavesProps) {
  function setSlot(kind: "space" | "ground", index: number, slot: PresentFacilitySlot | null): void {
    dispatch({ type: "setFacilitySlot", bodyId: body.bodyId, kind, index, slot });
  }

  return (
    <>
      {SLOT_KINDS.flatMap(({ kind, label, category }) => {
        const count = body.slots?.[kind] ?? 0;
        const slots = normalizeFacilitySlots(body.presentFacilities?.[kind], count);
        return slots.map((slot, index) => {
          const building = slot ? ALL_BUILDINGS[slot.building] : undefined;
          const buildingIsPort = building ? isPort(building) : false;
          return (
            <div className="facility-tree-slot" key={`${kind}-${index}`}>
              <span className="facility-tree-slot-label">
                {label} {index + 1}
              </span>
              <select
                aria-label={`${body.bodyName} ${label} slot ${index + 1} facility`}
                value={slot?.building ?? ""}
                disabled={locked}
                onChange={(e) => {
                  const value = e.target.value;
                  setSlot(kind, index, value === "" ? null : { building: value, demolishable: slot?.demolishable ?? false });
                }}
              >
                <option value="">— empty —</option>
                {ALL_CATEGORIES[category].map((name) => (
                  <option key={name} value={name}>
                    {toPrintable(name)}
                  </option>
                ))}
              </select>
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
                    onChange={(e) => setSlot(kind, index, { building: slot.building, demolishable: e.target.checked })}
                  />
                  Demolishable
                </label>
              )}
            </div>
          );
        });
      })}
    </>
  );
}

interface HierarchyBranchProps {
  node: BodyHierarchyNode;
  starSystem: string;
  firstStationBodyId: number | undefined;
  firstStationBuilding: string;
  locked: boolean;
  dispatch: Dispatch<PlannerAction>;
}

/** One level of the star/planet/moon/sub-moon hierarchy (see domain/bodyHierarchy.ts) — a branch
 * per level, indented further at each level via nested `.facility-tree-body` divs. `node.body` is
 * null for a level that was never itself scanned (only exists to group its descendants), which
 * renders just the heading with no slot leaves. The heading always shows the body's full name
 * (with the system name prefix, e.g. "Swoilz AW-C d52 B 10 e a") rather than just the trailing
 * "e"/"a"-style segment — a scanned body's own name is used verbatim; a synthetic (never scanned)
 * node's full name is reconstructed from the system name + its cumulative path. */
function HierarchyBranch({ node, starSystem, firstStationBodyId, firstStationBuilding, locked, dispatch }: HierarchyBranchProps) {
  const isFirstStationBody = node.body?.bodyId === firstStationBodyId;
  const fullName = node.body?.bodyName ?? `${starSystem} ${node.path}`;
  return (
    <div className="facility-tree-body">
      <div className="facility-tree-body-name">{fullName}</div>
      {node.body && isFirstStationBody && firstStationBuilding && (
        <PrimaryStationLeaf firstStationBuilding={firstStationBuilding} />
      )}
      {node.body && <BodySlotLeaves body={node.body} locked={locked} dispatch={dispatch} />}
      {node.children.map((child) => (
        <HierarchyBranch
          key={child.path}
          node={child}
          starSystem={starSystem}
          firstStationBodyId={firstStationBodyId}
          firstStationBuilding={firstStationBuilding}
          locked={locked}
          dispatch={dispatch}
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
  const stationBodyOptions = (
    formState.firstStationBuilding === "Asteroid_Base"
      ? formState.bodies.filter((b) => ringEligibleBodyIds.has(b.bodyId))
      : formState.bodies
  )
    .slice()
    .sort(compareBodyNames);

  // Locked (disabled + greyed) until a journal body layout is applied (see JournalImportPanel).
  // `systemConfigured` lives in formState itself (not local component state) specifically so a
  // `reset` re-locks it automatically.
  const locked = !formState.systemConfigured;

  // The primary station shows up as a leaf under whichever body it's assigned to (see
  // HierarchyBranch/the root's own leaves below) — but if it's been picked without a body
  // assignment yet, it still needs to be visible somewhere in the tree, so it floats directly
  // under the system root instead.
  const primaryStationUnassigned =
    hasBodies && formState.firstStationBuilding && formState.firstStationBodyId === undefined;

  const hierarchyRoot = hasBodies ? buildBodyHierarchy(formState.starSystem, formState.bodies) : null;

  function handleSave(): void {
    if (formState.systemAddress === null) return;
    saveSystem({
      systemAddress: formState.systemAddress,
      starSystem: formState.starSystem,
      bodies: formState.bodies,
      firstStationBuilding: formState.firstStationBuilding || undefined,
      firstStationBodyId: formState.firstStationBodyId,
    });
  }

  return (
    <section id="system-panel" className={`panel${locked ? " panel-unconfigured" : ""}`}>
      <div className="panel-header">
        <h2>System facilities</h2>
        <button type="button" onClick={handleSave} disabled={locked || formState.systemAddress === null}>
          Save
        </button>
      </div>
      <div className="row-grid">
        <div className="field">
          <label htmlFor="slot-space">Orbital slots</label>
          <NumberInput
            id="slot-space"
            value={formState.slots.space}
            blankMeans="zero"
            disabled
            onChange={() => {}}
          />
        </div>
        <div className="field">
          <label htmlFor="slot-ground">Ground slots</label>
          <NumberInput
            id="slot-ground"
            value={formState.slots.ground}
            blankMeans="zero"
            disabled
            onChange={() => {}}
          />
        </div>
        <div className="field">
          <label htmlFor="slot-asteroid">Asteroid slots</label>
          <NumberInput
            id="slot-asteroid"
            value={formState.slots.asteroid}
            blankMeans="zero"
            disabled
            onChange={() => {}}
          />
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
            onChange={(e) => dispatch({ type: "patch", patch: { firstStationBuilding: e.target.value } })}
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
          <div className="facility-tree-root">{formState.starSystem || "System"}</div>
          {primaryStationUnassigned && <PrimaryStationLeaf firstStationBuilding={formState.firstStationBuilding} />}
          {hierarchyRoot.body && (
            <div className="facility-tree-body">
              {formState.firstStationBodyId === hierarchyRoot.body.bodyId && formState.firstStationBuilding && (
                <PrimaryStationLeaf firstStationBuilding={formState.firstStationBuilding} />
              )}
              <BodySlotLeaves body={hierarchyRoot.body} locked={locked} dispatch={dispatch} />
            </div>
          )}
          {hierarchyRoot.children.map((child) => (
            <HierarchyBranch
              key={child.path}
              node={child}
              starSystem={formState.starSystem}
              firstStationBodyId={formState.firstStationBodyId}
              firstStationBuilding={formState.firstStationBuilding}
              locked={locked}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}
    </section>
  );
}
