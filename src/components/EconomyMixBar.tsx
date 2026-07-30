import { ECONOMY_COLORS } from "../data/buildings";
import type { PortEconomyLine } from "../domain/links";

interface EconomyMixBarProps {
  ratios: PortEconomyLine[];
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
export function EconomyMixBar({ ratios }: EconomyMixBarProps) {
  const nonZero = ratios.filter((r) => r.totalPercent > 0);
  if (nonZero.length === 0) return null;
  return (
    <span className="economy-mix-bar" aria-hidden="true">
      {nonZero.map((r) => (
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
      ))}
    </span>
  );
}
