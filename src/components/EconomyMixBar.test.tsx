// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ECONOMY_COLORS } from "../data/buildings";
import type { PortEconomyLine } from "../domain/links";
import { EconomyMixBar } from "./EconomyMixBar";

function line(economy: PortEconomyLine["economy"], totalPercent: number): PortEconomyLine {
  return { economy, ownPercent: totalPercent, strongPercent: 0, weakPercent: 0, totalPercent };
}

describe("EconomyMixBar", () => {
  it("sizes each segment's flex-grow by its share of the COMBINED total, not its own raw percentage", () => {
    // Matches the reference example: 240/170/110/50/35/20, summing to 625 — Industrial's flex-grow
    // is its own raw totalPercent (240), NOT 240% of anything; flexbox itself resolves the relative
    // proportions among every segment's flex-grow value, so no manual normalization is needed here.
    const ratios = [line("Industrial", 240), line("HighTech", 170), line("Extraction", 110)];
    const { container } = render(<EconomyMixBar ratios={ratios} />);
    const fills = Array.from(container.querySelectorAll(".economy-mix-bar-fill")) as HTMLElement[];
    expect(fills).toHaveLength(3);
    expect(fills[0].style.flexGrow).toBe("240");
    expect(fills[1].style.flexGrow).toBe("170");
    expect(fills[2].style.flexGrow).toBe("110");
    expect(fills[0].style.flexBasis).toBe("0px");
  });

  it("gives every segment the same minimum width floor, so a tiny minor economy never disappears next to a dominant one", () => {
    // Real reported case: Refinery 265% / Extraction 185% / Military 25% / Agriculture 10% — a plain
    // percentage-of-total width made Agriculture's ~2% share (and the bar's own `gap` between
    // segments) render as effectively invisible / clipped off entirely.
    const ratios = [line("Refinery", 265), line("Extraction", 185), line("Military", 25), line("Agriculture", 10)];
    const { container } = render(<EconomyMixBar ratios={ratios} />);
    const fills = Array.from(container.querySelectorAll(".economy-mix-bar-fill")) as HTMLElement[];
    expect(fills).toHaveLength(4);
    for (const fill of fills) expect(fill.style.minWidth).toBe("4px");
  });

  it("colors each segment with that economy's fixed color", () => {
    const { container } = render(<EconomyMixBar ratios={[line("Military", 20), line("Refinery", 50)]} />);
    const fills = Array.from(container.querySelectorAll(".economy-mix-bar-fill")) as HTMLElement[];
    expect(fills[0].style.background).toBe(ECONOMY_COLORS.Military);
    expect(fills[1].style.background).toBe(ECONOMY_COLORS.Refinery);
  });

  it("skips a zero-percent economy entirely", () => {
    const { container } = render(<EconomyMixBar ratios={[line("Colony", 0), line("Agriculture", 35)]} />);
    expect(container.querySelectorAll(".economy-mix-bar-fill")).toHaveLength(1);
  });

  it("renders nothing when every economy is 0%", () => {
    const { container } = render(<EconomyMixBar ratios={[line("Colony", 0)]} />);
    expect(container.querySelector(".economy-mix-bar")).toBeNull();
  });

  it("is hidden from assistive tech (purely decorative — the row list beneath it carries the numbers)", () => {
    const { container } = render(<EconomyMixBar ratios={[line("Tourism", 10), line("Colony", 5)]} />);
    expect(container.querySelector(".economy-mix-bar")).toHaveAttribute("aria-hidden", "true");
  });
});
