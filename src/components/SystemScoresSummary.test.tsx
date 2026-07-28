// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ALL_SCORES, type Score } from "../data/buildings";
import { SystemScoresSummary } from "./SystemScoresSummary";

const ZERO_SCORES = Object.fromEntries(ALL_SCORES.map((score) => [score, 0])) as Record<Score, number>;

describe("SystemScoresSummary's emphasized card", () => {
  it("is not wrapped in the emphasized card by default", () => {
    const { container } = render(<SystemScoresSummary scores={ZERO_SCORES} />);
    expect(container.querySelector(".system-scores-emphasized")).not.toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });

  it("wraps the block in the emphasized card when emphasized is set", () => {
    const { container } = render(<SystemScoresSummary scores={ZERO_SCORES} emphasized />);
    const card = container.querySelector(".system-scores-emphasized");
    expect(card).toBeInTheDocument();
    expect(card).toContainElement(screen.getByText("security"));
  });
});
