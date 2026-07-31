// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ECONOMY_COLORS } from "../data/buildings";
import type { PortEconomyLine, PortSummary } from "../domain/links";
import { EconomyMixBar, SystemEconomyRatioSumBar } from "./EconomyMixBar";

function line(economy: PortEconomyLine["economy"], totalPercent: number): PortEconomyLine {
  return { economy, ownPercent: totalPercent, strongPercent: 0, weakPercent: 0, totalPercent };
}

function makePort(bodyId: number, economyRatios: PortEconomyLine[]): PortSummary {
  return {
    building: `Port ${bodyId}`,
    bodyId,
    tier: 1,
    economies: economyRatios.map((r) => r.economy),
    appliedOverrideRules: [],
    unevaluatedOverrideRules: [],
    isDominantOnBody: true,
    economyRatios,
    marketLinks: [],
  };
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

  it("adds the large modifier class only when the large prop is set (SolvedSystemPanel's doubled-height system-wide sum)", () => {
    const ratios = [line("Tourism", 10)];
    const { container: normal } = render(<EconomyMixBar ratios={ratios} />);
    expect(normal.querySelector(".economy-mix-bar")).not.toHaveClass("economy-mix-bar-large");

    const { container: large } = render(<EconomyMixBar ratios={ratios} large />);
    expect(large.querySelector(".economy-mix-bar")).toHaveClass("economy-mix-bar-large");
  });

  it("segmentTooltips: hovering one segment shows only that segment's own economy+percentage, not the others", () => {
    const ratios = [line("Military", 20), line("Refinery", 50)];
    const { container } = render(<EconomyMixBar ratios={ratios} segmentTooltips />);
    const fills = Array.from(container.querySelectorAll(".economy-mix-bar-fill")) as HTMLElement[];
    expect(fills).toHaveLength(2);

    fireEvent.mouseEnter(fills[0].closest(".tooltip-anchor") as HTMLElement);
    expect(screen.getByText("Military: 20%")).toBeInTheDocument();
    expect(screen.queryByText("Refinery: 50%")).not.toBeInTheDocument();
  });

  it("segmentTooltips: moves each segment's own flex sizing onto its Tooltip anchor, so wrapping it doesn't collapse the layout", () => {
    const ratios = [line("Military", 20), line("Refinery", 50)];
    const { container } = render(<EconomyMixBar ratios={ratios} segmentTooltips />);
    const anchors = Array.from(container.querySelectorAll(".tooltip-anchor")) as HTMLElement[];
    expect(anchors).toHaveLength(2);
    expect(anchors[0].style.flexGrow).toBe("20");
    expect(anchors[1].style.flexGrow).toBe("50");
    // The inner fill itself no longer carries the sizing — it just fills whatever size the anchor got.
    const fills = Array.from(container.querySelectorAll(".economy-mix-bar-fill")) as HTMLElement[];
    expect(fills[0].style.flexGrow).toBe("");
  });

  it("does not wrap segments in a Tooltip at all when segmentTooltips is unset (default, per-facility hover usage)", () => {
    const { container } = render(<EconomyMixBar ratios={[line("Military", 20)]} />);
    expect(container.querySelector(".tooltip-anchor")).toBeNull();
  });
});

describe("SystemEconomyRatioSumBar", () => {
  it("renders the label and bar when the system's ports carry economy ratio data", () => {
    const ports = [makePort(1, [line("Agriculture", 100)]), makePort(2, [line("Military", 40)])];
    render(<SystemEconomyRatioSumBar ports={ports} />);
    expect(screen.getByText("System-wide sum of economy ratios:")).toBeInTheDocument();
    expect(document.querySelector(".economy-mix-bar")).toBeInTheDocument();
  });

  it("renders nothing when no port carries any economy ratio", () => {
    const { container } = render(<SystemEconomyRatioSumBar ports={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("gives the outer (pinnable) trigger an accessible name, since EconomyMixBar's own root is aria-hidden", () => {
    const ports = [makePort(1, [line("Agriculture", 100)])];
    render(<SystemEconomyRatioSumBar ports={ports} />);
    expect(screen.getByRole("button", { name: /System-wide sum of economy ratios/ })).toBeInTheDocument();
  });

  it("only opens on click (pin), not on hover — avoids overlapping with the per-segment hover tooltips", () => {
    const ports = [makePort(1, [line("Agriculture", 100)])];
    render(<SystemEconomyRatioSumBar ports={ports} />);
    const trigger = screen.getByRole("button", { name: /System-wide sum of economy ratios/ });

    fireEvent.mouseEnter(trigger);
    expect(screen.queryByText("System-wide sum, by economy")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByText("System-wide sum, by economy")).toBeInTheDocument();
  });
});
