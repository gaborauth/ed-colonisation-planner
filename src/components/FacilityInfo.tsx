// The "i" info icons shared by SystemConfigPanel.tsx's "Actual facilities in the system" tree and
// SolvedSystemPanel.tsx's read-only "Solved system" tree — both trees show the same kind of thing
// (a body/slot in a per-body hierarchy) and both want the same economy/links/stats hover, just fed
// a different `SystemLinksResult` (present-facilities-only vs. a solved plan's placements). Kept as
// a single shared module rather than duplicated, since both panels need the exact same hover content.

import { Fragment, type ReactNode } from "react";
import { ALL_BUILDINGS, BASE_SCORES, ECONOMY_COLORS, isPortRole, toPrintable } from "../data/buildings";
import {
  computeColonyEconomyBreakdown,
  computeEconomyRatios,
  computeStrongLinkBreakdown,
  facilityBaseEconomies,
  hasGeologicals,
  hasOrganics,
  hasRings,
  hasVolcanism,
  isTerraformable,
  isTidalLockChainToStar,
  TERRAFORMABLE_AGRICULTURE_BUG_LINK,
  TERRAFORMABLE_AGRICULTURE_BUG_NOTE,
  type EconomyBreakdown,
} from "../domain/economyOverrides";
import type { MarketLinkLine, PortEconomyLine, SystemLinksResult } from "../domain/links";
import type { StrongLinkedInstance } from "../domain/presentLinks";
import { METERS_PER_SECOND_SQUARED_PER_G } from "../journal/eligibility";
import type { JournalBody } from "../journal/parser";
import { EconomyMixBar } from "./EconomyMixBar";
import { Tooltip } from "./Tooltip";

/** A facility/port's full "Economy ratios" breakdown for the hover box: for a port-role building,
 * `linksResult.ports` already has this precomputed (own value + summed incoming-strong-link
 * contribution + summed incoming-weak-link contribution + their sum — see `links.ts`'s
 * `PortEconomyLine`), so this just looks that entry up; a non-port supporting facility never
 * receives a strong OR weak link (only port<->facility or port<->port links exist, per CLAUDE.md's
 * link topology), so it falls back to its own-only ratio via `computeEconomyRatios`/
 * `facilityBaseEconomies`, with `strongPercent`/`weakPercent` fixed at 0 — this keeps one shared row
 * shape (`PortEconomyLine`) for both cases, so `facilityInfoContent` below doesn't need two
 * different rendering paths. The `linksResult.ports` lookup falling through to the same own-only
 * fallback (rather than an empty list) is a safety net for a body/building combination
 * `computeSystemLinks` hasn't recorded yet, not an expected steady-state path.
 *
 * `isDominantInstance` (default `true`, so every existing single-instance call site is unaffected):
 * a body can have MULTIPLE physical instances of the exact same port building type (see `links.ts`'s
 * `portCounts` doc comment), but `linksResult.ports` still only carries ONE aggregate `PortSummary`
 * per (body, building name) — real-game-accurate for only ONE of those physical instances (the
 * dominant one that actually receives local strong/weak links); every OTHER instance of the
 * identical type must NOT show that same aggregate content as if it, too, were independently
 * receiving everything (two identical-type slots both showing "receives strong links," when only
 * one physically can, would misrepresent the actual link topology). Callers
 * that render one info hover per physical slot (`SystemConfigPanel.tsx`/`SolvedSystemPanel.tsx`)
 * are responsible for tracking, per body, which physical slot is the FIRST occurrence of a given
 * building name — only that one passes `true`; every later occurrence of the same name at the same
 * body passes `false` and falls through to the own-only fallback below, same as a non-port facility
 * (a non-dominant instance's own base economy is still real and still shown — only the
 * strong/weak-link RECEIVING side is suppressed for it). */
export function facilityEconomyRatios(
  building: string,
  body: JournalBody,
  allBodies: JournalBody[],
  linksResult: SystemLinksResult,
  isDominantInstance = true,
): PortEconomyLine[] {
  if (isPortRole(building) && isDominantInstance) {
    const port = linksResult.ports.find((p) => p.bodyId === body.bodyId && p.building === building);
    if (port) return port.economyRatios;
  }
  return computeEconomyRatios(facilityBaseEconomies(building, body), body, allBodies).map((r) => ({
    economy: r.economy,
    ownPercent: r.percent,
    strongPercent: 0,
    weakPercent: 0,
    totalPercent: r.percent,
  }));
}

/** The "Market links" hover table's rows — a supporting facility never receives any link itself
 * (only ports do, per CLAUDE.md's link topology), so this is always empty for one; `links.ts`'s
 * `PortSummary.marketLinks` already has everything precomputed for a port. `isDominantInstance` is
 * the same per-physical-slot disambiguation `facilityEconomyRatios` above documents — a non-first
 * instance of a duplicated port building type never receives anything, so this is always empty for
 * one too, same as a non-port facility. */
export function facilityMarketLinks(
  building: string,
  body: JournalBody,
  linksResult: SystemLinksResult,
  isDominantInstance = true,
): MarketLinkLine[] {
  if (!isPortRole(building) || !isDominantInstance) return [];
  return linksResult.ports.find((p) => p.bodyId === body.bodyId && p.building === building)?.marketLinks ?? [];
}

interface FacilityInfoProps {
  building: string;
  bodyName: string;
  slotLabel: string;
  nickname: string | undefined;
  variant: string | undefined;
  economyRatios: PortEconomyLine[];
  marketLinks: MarketLinkLine[];
  strongLinks: StrongLinkedInstance[];
}

/** 0 renders as "-" — used both for a `MarketLinkLine`'s counts (whole point is showing which of
 * the two link types actually contributes, so a column of zeroes among nonzero values reads worse
 * than a plain dash) and, with `unit` supplied, for percentages elsewhere. */
function numberOrDash(value: number, unit = ""): string {
  return value === 0 ? "-" : `${value}${unit}`;
}

/** Hover-box body for `FacilityInfoIcon` below: a "Basic data" block (nickname/build type/body/
 * slot/status), an "Economy ratios" block (leads with the total — the headline number, UX-wise —
 * then, only when at least one economy actually has a nonzero strong- or weak-link contribution, a
 * source-by-source breakdown underneath it: body/strong link/weak link, each only shown if it's
 * actually nonzero; see `facilityEconomyRatios` above), a "Market links" block (only for ports, only
 * when at least one economy has an incoming strong or weak link — a 3-column Economy/Strong
 * link/Weak link table of *counts*, not percentages, see `facilityMarketLinks` above), a "Strong
 * market link(s)" block (only for ports — see `strongLinkedInstances`; the header itself is
 * singular/plural/absent depending on the count), and a "System effects and haul" block (this
 * building's non-zero score contributions, T2/T3 point cost, and construction cost standing in for
 * "haul" — no real commodity/tonnage model exists, see CLAUDE.md's scope boundaries). `status` lets
 * SolvedSystemPanel.tsx's read-only tree distinguish an already-built slot from one the solver
 * merely proposes (SystemConfigPanel.tsx's tree only ever shows "Built", the only status it has). */
function facilityInfoContent({
  building: name,
  bodyName,
  slotLabel,
  nickname,
  variant,
  economyRatios,
  marketLinks,
  strongLinks,
  status = "Built",
}: FacilityInfoProps & { status?: string }) {
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
      <div>Status: {status}</div>
      {economyRatios.length > 0 && (
        <>
          <div className="facility-info-section-header">Economy ratios</div>
          {economyRatios.length > 1 && <EconomyMixBar ratios={economyRatios} />}
          {economyRatios.map((r) => {
            const hasLinkContribution = r.strongPercent > 0 || r.weakPercent > 0;
            return (
              <Fragment key={r.economy}>
                <div className="facility-info-economy-row">
                  <span className="economy-swatch" style={{ background: ECONOMY_COLORS[r.economy] }} />
                  {r.economy}: {r.totalPercent}%
                </div>
                {hasLinkContribution && (
                  <>
                    {r.ownPercent > 0 && <div className="facility-info-economy-sub">body: {r.ownPercent}%</div>}
                    {r.strongPercent > 0 && <div className="facility-info-economy-sub">strong link: {r.strongPercent}%</div>}
                    {r.weakPercent > 0 && <div className="facility-info-economy-sub">weak link: {r.weakPercent}%</div>}
                  </>
                )}
              </Fragment>
            );
          })}
        </>
      )}
      {marketLinks.length > 0 && (
        <>
          <div className="facility-info-section-header">Market links</div>
          <div className="facility-info-market-links">
            <span className="facility-info-market-links-header">Economy</span>
            <span className="facility-info-market-links-header">Strong link</span>
            <span className="facility-info-market-links-header">Weak link</span>
            {marketLinks.map((m) => (
              <Fragment key={m.economy}>
                <span>
                  <span className="economy-swatch" style={{ background: ECONOMY_COLORS[m.economy] }} /> {m.economy}
                </span>
                <span>{numberOrDash(m.strongCount)}</span>
                <span>{numberOrDash(m.weakCount)}</span>
              </Fragment>
            ))}
          </div>
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

/** The "i" icon shown before every slot's label — hoverable with a `Tooltip` summarizing the
 * building actually built (or, from SolvedSystemPanel.tsx, solver-proposed) there when the slot
 * isn't empty, greyed out and inert for an empty slot (nothing to show). `status` defaults to
 * "Built" (SystemConfigPanel.tsx's only case); SolvedSystemPanel.tsx passes e.g. "Proposed (build
 * #3)" for a newly-solved-for slot. */
export function FacilityInfoIcon({
  building,
  bodyName,
  slotLabel,
  nickname,
  variant,
  economyRatios,
  marketLinks,
  strongLinks,
  status,
}: {
  building: string | undefined;
  bodyName: string;
  slotLabel: string;
  nickname: string | undefined;
  variant: string | undefined;
  economyRatios: PortEconomyLine[];
  marketLinks: MarketLinkLine[];
  strongLinks: StrongLinkedInstance[];
  status?: string;
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
      content={facilityInfoContent({ building, bodyName, slotLabel, nickname, variant, economyRatios, marketLinks, strongLinks, status })}
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
                {i === 0 && (
                  <td rowSpan={block.lines.length}>
                    <span className="economy-swatch" style={{ background: ECONOMY_COLORS[block.economy] }} />{" "}
                    {block.economy}
                  </td>
                )}
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
export function BodyInfoIcon({ body, allBodies }: { body: JournalBody; allBodies: JournalBody[] }) {
  return (
    <Tooltip content={bodyInfoContent(body, allBodies)} pinnable>
      <span className="facility-info-icon" aria-label={`${body.bodyName} info`}>
        ⓘ
      </span>
    </Tooltip>
  );
}
