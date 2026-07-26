import { useMemo } from "react";
import { isPortRole, toPrintable } from "../data/buildings";
import { buildBodyHierarchy, type BodyHierarchyNode } from "../domain/bodyHierarchy";
import type { SystemLinksResult } from "../domain/links";
import { getOrderingFromResult } from "../domain/ordering";
import type { StrongLinkedInstance } from "../domain/presentLinks";
import { computeSolvedPlacements, type SolvedBodySlots, type SolvedSlot } from "../domain/solvedPlacement";
import { computeSolvedSystemLinks } from "../domain/solvedLinks";
import type { JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";
import { BodyInfoIcon, facilityEconomyRatios, facilityMarketLinks, FacilityInfoIcon } from "./FacilityInfo";
import { SystemScoresSummary } from "./SystemScoresSummary";

interface SolvedSystemPanelProps {
  formState: PlannerFormState;
  result: SolverResult | null;
}

const SLOT_KINDS: { kind: "space" | "ground"; label: string }[] = [
  { kind: "space", label: "Orbital" },
  { kind: "ground", label: "Ground" },
];

/** One slot's display text + color class — mirrors SystemConfigPanel.tsx's per-slot leaf, but
 * read-only text instead of an editable `<select>` (this tree shows what the solver proposes, not
 * something the user edits directly — editing still happens in "Actual facilities in the system"). */
function describeSlot(slot: SolvedSlot, firstStationBuilding: string): { text: string; className: string } {
  switch (slot.status) {
    case "empty":
      return { text: "— empty —", className: "solved-slot-empty" };
    case "primary":
      return { text: `${toPrintable(firstStationBuilding)} ★ (primary)`, className: "solved-slot-present" };
    case "present":
      return {
        text: `${toPrintable(slot.building)}${slot.nickname ? ` — ${slot.nickname}` : ""} (built)`,
        className: "solved-slot-present",
      };
    case "new":
      return { text: `${toPrintable(slot.building)} — build #${slot.order}`, className: "solved-slot-new" };
    case "demolished":
      return { text: `demolish ${toPrintable(slot.building)}`, className: "solved-slot-demolished" };
    case "demolished-rebuilt":
      return {
        text: `demolish ${toPrintable(slot.demolishedBuilding)} → ${toPrintable(slot.building)} — build #${slot.order}`,
        className: "solved-slot-new",
      };
  }
}

/** What the "i" icon (see FacilityInfo.tsx's `FacilityInfoIcon`) should show for a slot: which
 * building (if any — an `empty`/`demolished`-with-nothing-rebuilt slot has none) and a status label
 * distinguishing "already built" from "the solver proposes this" (SystemConfigPanel.tsx's tree only
 * ever has the former, hence `FacilityInfoIcon`'s "Built" default — this tree needs both). */
function slotIconInfo(slot: SolvedSlot, firstStationBuilding: string): { building: string | undefined; status: string } {
  switch (slot.status) {
    case "empty":
    case "demolished":
      return { building: undefined, status: "" };
    case "primary":
      return { building: firstStationBuilding, status: "Built (primary station)" };
    case "present":
      return { building: slot.building, status: "Built" };
    case "new":
      return { building: slot.building, status: `Proposed — build #${slot.order}` };
    case "demolished-rebuilt":
      return {
        building: slot.building,
        status: `Proposed — build #${slot.order} (replaces demolished ${toPrintable(slot.demolishedBuilding)})`,
      };
  }
}

/** Solved-tree counterpart of `domain/presentLinks.ts`'s `strongLinkedInstances` — same idea (a
 * port's incoming strong links, one row per giving instance), but without that function's nickname
 * resolution: a strong link here can come from a facility the solver merely proposes (not yet in
 * any body's `presentFacilities`, so it has no nickname to look up), and mixing already-nicknamed
 * present givers with un-nicknamed proposed ones per-instance would be an arbitrary pairing anyway
 * (`links.ts`'s `StrongLink` only carries an aggregated `{fromBuilding, count}`, not per-instance
 * identity) — every row here is nickname-less by design, not a lookup that came up empty. */
function solvedStrongLinks(linksResult: SystemLinksResult, bodyId: number, portBuilding: string): StrongLinkedInstance[] {
  const instances: StrongLinkedInstance[] = [];
  for (const link of linksResult.strongLinks) {
    if (link.bodyId !== bodyId || link.toPortBuilding !== portBuilding) continue;
    for (let i = 0; i < link.count; i++) instances.push({ building: link.fromBuilding, nickname: undefined });
  }
  return instances;
}

function SlotLeaves({
  body,
  slots,
  allBodies,
  linksResult,
  firstStationBuilding,
}: {
  body: JournalBody;
  slots: SolvedBodySlots;
  allBodies: JournalBody[];
  linksResult: SystemLinksResult;
  firstStationBuilding: string;
}) {
  return (
    <>
      {SLOT_KINDS.flatMap(({ kind, label }) =>
        slots[kind].map((slot, index) => {
          const { text, className } = describeSlot(slot, firstStationBuilding);
          const { building, status } = slotIconInfo(slot, firstStationBuilding);
          const economyRatios = building ? facilityEconomyRatios(building, body, allBodies, linksResult) : [];
          const marketLinks = building ? facilityMarketLinks(building, body, linksResult) : [];
          const strongLinks = building && isPortRole(building) ? solvedStrongLinks(linksResult, body.bodyId, building) : [];
          return (
            <div className="facility-tree-slot" key={`${kind}-${index}`}>
              <FacilityInfoIcon
                building={building}
                bodyName={body.bodyName}
                slotLabel={`${label} ${index + 1}`}
                nickname={slot.status === "present" ? slot.nickname : undefined}
                variant={slot.status === "present" ? slot.variant : undefined}
                economyRatios={economyRatios}
                marketLinks={marketLinks}
                strongLinks={strongLinks}
                status={status}
              />
              <span className="facility-tree-slot-label">
                {label} {index + 1}
              </span>
              <span className={className}>{text}</span>
            </div>
          );
        }),
      )}
    </>
  );
}

interface BranchProps {
  node: BodyHierarchyNode;
  starSystem: string;
  firstStationBuilding: string;
  byBody: Map<number, SolvedBodySlots>;
  allBodies: JournalBody[];
  linksResult: SystemLinksResult;
}

function Branch({ node, starSystem, firstStationBuilding, byBody, allBodies, linksResult }: BranchProps) {
  const fullName = node.body?.bodyName ?? `${starSystem} ${node.path}`;
  const slots = node.body ? byBody.get(node.body.bodyId) : undefined;
  return (
    <div className="facility-tree-body">
      <div className="facility-tree-body-name">
        {node.body && <BodyInfoIcon body={node.body} allBodies={allBodies} />}
        {fullName}
      </div>
      {node.body && slots && (
        <SlotLeaves body={node.body} slots={slots} allBodies={allBodies} linksResult={linksResult} firstStationBuilding={firstStationBuilding} />
      )}
      {node.children.map((child) => (
        <Branch
          key={child.path}
          node={child}
          starSystem={starSystem}
          firstStationBuilding={firstStationBuilding}
          byBody={byBody}
          allBodies={allBodies}
          linksResult={linksResult}
        />
      ))}
    </div>
  );
}

/** Read-only sibling of SystemConfigPanel's "Actual facilities in the system" tree: once a solve
 * has run, shows the SAME per-body hierarchy but with every empty slot the solver chose to fill
 * actually filled in, each tagged with its position in the build order (see
 * domain/solvedPlacement.ts) — "which order do I build these in without ever going T2/T3-negative."
 * Also carries the same "i" info icons as that tree (body economy + per-slot economy
 * ratios/market links/strong links — see components/FacilityInfo.tsx), computed from the SOLVED
 * plan's link topology (`computeSystemLinks` fed `result.placements`, not the present-only one
 * `SystemConfigPanel.tsx` uses) so a newly-proposed facility's economy contribution shows up too,
 * not just already-built ones. Needs both a per-body layout (`formState.bodies`, from Journal
 * Import) and a completed solve; shows an explanatory placeholder instead of a tree until both are
 * present. */
export function SolvedSystemPanel({ formState, result }: SolvedSystemPanelProps) {
  const hasBodies = formState.bodies.length > 0;

  const { solved, orderError, linksResult } = useMemo(() => {
    if (!hasBodies || !result) return { solved: null, orderError: null, linksResult: null };
    const links = computeSolvedSystemLinks(formState.bodies, result);
    try {
      const newBuildOrder = getOrderingFromResult(toPlanResult(formState, result), true, false);
      return { solved: computeSolvedPlacements(formState.bodies, result, newBuildOrder), orderError: null, linksResult: links };
    } catch (e) {
      return { solved: null, orderError: (e as Error).message, linksResult: links };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formState.bodies/firstStation* + result together identify a solve; re-deriving formState identity every render would defeat the memo
  }, [formState, result, hasBodies]);

  const hierarchyRoot = hasBodies ? buildBodyHierarchy(formState.starSystem, formState.bodies) : null;

  return (
    <section className="panel">
      <h2>Solved system</h2>
      {!hasBodies && (
        <p className="panel-hint">
          Apply a journal body layout in "Actual facilities in the system" to see a per-body solved layout here.
        </p>
      )}
      {hasBodies && !result && <p className="panel-hint">Solve the system to see the proposed layout.</p>}
      {orderError && <div className="status-banner">Could not compute a build order: {orderError}</div>}
      {solved && solved.warnings.length > 0 && (
        // Informational, not a failure — see LinksPanel.tsx's matching note. The tree below still
        // renders in full; this just flags a data-consistency mismatch it fell back gracefully on.
        <div className="status-banner hint">{solved.warnings.join(" ")}</div>
      )}
      {result && (
        // The old standalone Result panel's content, moved here (2026-07-26) — same
        // SystemScoresSummary as "Actual facilities in the system"'s current-totals view above it,
        // but for the SOLVED plan's own totals (already includes economy_synergy, since solve.ts
        // computed a real value for it, unlike the current-only view).
        <SystemScoresSummary
          scores={result.scores}
          extraFields={[
            { label: "Orbital slots left", value: result.slotsRemaining.space, neutral: true },
            { label: "Ground slots left", value: result.slotsRemaining.ground, neutral: true },
            { label: "Asteroid slots left", value: result.slotsRemaining.asteroid, neutral: true },
            { label: "T2 points left", value: result.finalT2Points },
            { label: "T3 points left", value: result.finalT3Points },
            ...(result.firstStation ? [{ label: "First station", value: toPrintable(result.firstStation), neutral: true }] : []),
            ...(result.objectiveValue !== null
              ? [{ label: "Objective value", value: Math.round(result.objectiveValue * 1000) / 1000, neutral: true }]
              : []),
          ]}
        />
      )}
      {hierarchyRoot && solved && linksResult && (
        <div className="facility-tree">
          <div className="facility-tree-root">
            {hierarchyRoot.body && <BodyInfoIcon body={hierarchyRoot.body} allBodies={formState.bodies} />}
            {formState.starSystem || "System"}
          </div>
          {hierarchyRoot.body && (
            <div className="facility-tree-body">
              <SlotLeaves
                body={hierarchyRoot.body}
                slots={solved.byBody.get(hierarchyRoot.body.bodyId) ?? { space: [], ground: [] }}
                allBodies={formState.bodies}
                linksResult={linksResult}
                firstStationBuilding={formState.firstStationBuilding}
              />
            </div>
          )}
          {hierarchyRoot.children.map((child) => (
            <Branch
              key={child.path}
              node={child}
              starSystem={formState.starSystem}
              firstStationBuilding={formState.firstStationBuilding}
              byBody={solved.byBody}
              allBodies={formState.bodies}
              linksResult={linksResult}
            />
          ))}
        </div>
      )}
    </section>
  );
}
