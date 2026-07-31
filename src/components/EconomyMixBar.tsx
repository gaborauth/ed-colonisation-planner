import { ECONOMY_COLORS } from "../data/buildings";
import { sumSystemEconomyRatios, type PortEconomyLine, type PortSummary } from "../domain/links";
import { Tooltip } from "./Tooltip";

interface EconomyMixBarProps {
  ratios: PortEconomyLine[];
  /** Doubled height (see `.economy-mix-bar-large` in index.css) — `SolvedSystemPanel`'s system-wide
   * sum uses this so it reads as a headline summary figure, distinct from the same bar's normal
   * size everywhere else (per-facility hovers). */
  large?: boolean;
  /** Wraps each segment in its own small, hover-only (never `pinnable`) `Tooltip` showing just that
   * one economy's name and percentage. Opt-in, not the default: the per-facility "Economy ratios"
   * hover (`FacilityInfo.tsx`) already lists every row right below the bar, so per-segment hovers
   * there would just repeat what's already visible. `SolvedSystemPanel`'s system-wide sum uses this
   * instead, since its own full breakdown only shows inside the bar's own (pinnable) tooltip, not
   * displayed alongside it — a quick per-segment hover answers "which economy is this stripe" without
   * needing to open/read the whole list. */
  segmentTooltips?: boolean;
}

/** Every segment gets at least this much width, even a tiny minor economy next to a dominant one
 * (real observed case: Refinery 265% / Extraction 185% / Military 25% / Agriculture 10% — Agriculture's
 * true proportional share is under 2% of the bar, effectively invisible without a floor). Enforced by
 * flexbox's own `min-width` handling (see below), not hand-rolled math, so it composes correctly with
 * the `gap` between segments however many there are. */
const MIN_SEGMENT_WIDTH_PX = 4;

/** The "Economy ratios" hover's headline visual for a facility carrying more than one economy type
 * at once (a generic Colony-derived port almost always does — see CLAUDE.md's Colony economy
 * override table) — one combined bar, split into a segment per economy sized by that economy's
 * share of this facility's combined total (`totalPercent` summed across every row), not by its own
 * absolute percentage — the bar always fills exactly 100% regardless of how high the raw percentages
 * run (real values routinely exceed 100% once strong/weak links stack). Sizing uses `flex-grow`
 * (proportional to `totalPercent`) from a `flex-basis: 0`, with a `min-width` floor
 * (`MIN_SEGMENT_WIDTH_PX`) — this is deliberately NOT a plain `width: X%`: percentage widths that
 * already sum to 100% plus this bar's own `gap` between segments overflow the container, and since
 * it clips overflow, the LAST (often smallest) segment could get cut off entirely rather than just
 * looking thin. Flexbox's grow/shrink resolution already accounts for `gap` and enforces `min-width`
 * without any manual redistribution math (a segment pinned to the floor is "frozen"; the browser
 * redistributes the remaining space among the rest by their relative `flex-grow`). Each segment is
 * colored by `ECONOMY_COLORS`, the same fixed color every row's own swatch uses below it, so the bar
 * and the list read as one picture. Not rendered at all for a single-economy facility — a
 * one-segment, always-100%-wide bar would carry no information (see `facilityInfoContent`'s call
 * site, gated on `ratios.length > 1`). Purely decorative — every segment's exact number is already
 * in the row list beneath it — hidden from assistive tech. */
export function EconomyMixBar({ ratios, large, segmentTooltips }: EconomyMixBarProps) {
  const nonZero = ratios.filter((r) => r.totalPercent > 0);
  if (nonZero.length === 0) return null;
  return (
    <span className={`economy-mix-bar${large ? " economy-mix-bar-large" : ""}`} aria-hidden="true">
      {nonZero.map((r) => {
        // Sizing (flexGrow/flexBasis/minWidth) only takes effect on a direct child of this flex
        // container — when `segmentTooltips` wraps a segment in `Tooltip`, that sizing has to move
        // onto the Tooltip's own anchor `<span>` (via `anchorStyle`) instead of staying on the inner
        // fill, otherwise the anchor interposes an unsized flex item and the layout collapses.
        if (!segmentTooltips) {
          return (
            <span
              key={r.economy}
              className="economy-mix-bar-fill"
              style={{
                flexGrow: r.totalPercent,
                flexBasis: 0,
                minWidth: MIN_SEGMENT_WIDTH_PX,
                background: ECONOMY_COLORS[r.economy],
              }}
            />
          );
        }
        return (
          <Tooltip
            key={r.economy}
            anchorStyle={{ display: "block", flexGrow: r.totalPercent, flexBasis: 0, minWidth: MIN_SEGMENT_WIDTH_PX }}
            content={`${r.economy}: ${r.totalPercent}%`}
          >
            <span className="economy-mix-bar-fill" style={{ width: "100%", height: "100%", background: ECONOMY_COLORS[r.economy] }} />
          </Tooltip>
        );
      })}
    </span>
  );
}

/** Shared hover content for `SystemEconomyRatioSumBar`'s own (pinnable) tooltip below — the same
 * per-economy row shape (swatch + name + percentage) `FacilityInfo.tsx`'s per-facility "Economy
 * ratios" hover uses, minus the own/strong/weak sub-breakdown (meaningless once summed across ports
 * with different tiers/dominance — see `sumSystemEconomyRatios`'s doc comment in domain/links.ts). */
function economyMixBarTooltipContent(ratios: PortEconomyLine[]) {
  return (
    <>
      <div className="facility-info-section-header">System-wide sum, by economy</div>
      {ratios.map((r) => (
        <div className="facility-info-economy-row" key={r.economy}>
          <span className="economy-swatch" style={{ background: ECONOMY_COLORS[r.economy] }} />
          {r.economy}: {r.totalPercent}%
        </div>
      ))}
    </>
  );
}

/** "System-wide sum of economy ratios" headline visual — every port's own `economyRatios` (own +
 * incoming strong + incoming weak, per economy) summed across the WHOLE system, not per-port; a
 * rough, easy-to-eyeball counterpart to `ObjectivePanel`'s per-economy preference sliders (also
 * whole-system, not per-port). Shared between `SystemConfigPanel`'s "Actual facilities" (present-only
 * link topology) and `SolvedSystemPanel`'s "Solved system" (post-solve link topology) — both pass
 * their own `SystemLinksResult.ports` through unchanged, so this component owns the one aggregation +
 * rendering, not two near-duplicate copies. Renders nothing if the system carries no economy ratio
 * data at all yet (e.g. no facilities built/placed). Doubled-height bar (`large`) so it reads as a
 * headline figure rather than the small accent every per-facility hover uses, pinnable (click to keep
 * the full breakdown open) — `hoverPreview={false}` on the outer Tooltip so it only ever opens via
 * click, not hover, since the bar's own per-segment tooltips (`segmentTooltips`) already answer
 * "which economy is this stripe" on hover; letting both respond to hover at the same pointer
 * position would show two overlapping bubbles at once. `anchorLabel` gives the outer (pinnable,
 * `role="button"`) trigger an accessible name, since `EconomyMixBar`'s own root is `aria-hidden`
 * and would otherwise leave it silent to assistive tech. */
export function SystemEconomyRatioSumBar({ ports }: { ports: PortSummary[] }) {
  const ratios = sumSystemEconomyRatios(ports);
  if (!ratios.some((r) => r.totalPercent > 0)) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="panel-hint" style={{ marginBottom: 4 }}>
        System-wide sum of economy ratios:
      </div>
      <Tooltip
        anchorClassName="economy-mix-bar-tooltip-anchor"
        anchorLabel="System-wide sum of economy ratios — click for the full breakdown"
        content={economyMixBarTooltipContent(ratios)}
        pinnable
        hoverPreview={false}
      >
        <EconomyMixBar ratios={ratios} large segmentTooltips />
      </Tooltip>
    </div>
  );
}
