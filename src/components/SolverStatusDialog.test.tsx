// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SolverStatusDialog } from "./SolverStatusDialog";

describe("SolverStatusDialog", () => {
  it("renders nothing when idle", () => {
    render(<SolverStatusDialog status="idle" message={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing when done", () => {
    render(<SolverStatusDialog status="done" message={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a blocking dialog with an animated progress bar and no dismiss control while solving", () => {
    const { container } = render(<SolverStatusDialog status="solving" message={null} onDismiss={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Solving" })).toBeInTheDocument();
    expect(screen.getByText("Running the solver…")).toBeInTheDocument();
    expect(container.querySelector(".solver-progress-bar-fill")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a '(pass X of Y)' suffix while solving a multi-pass run", () => {
    render(
      <SolverStatusDialog status="solving" message={null} progress={{ pass: 2, total: 4 }} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("Running the solver… (pass 2 of 4)")).toBeInTheDocument();
  });

  it("omits the pass suffix when progress.total is 1 (single-pass, today's default)", () => {
    render(
      <SolverStatusDialog status="solving" message={null} progress={{ pass: 1, total: 1 }} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText("Running the solver…")).toBeInTheDocument();
  });

  it("shows the error message and a Close button on error, calling onDismiss when clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SolverStatusDialog status="error" message="No possible system arrangement" onDismiss={onDismiss} />);

    expect(screen.getByRole("dialog", { name: "Solver error" })).toBeInTheDocument();
    expect(screen.getByText("No possible system arrangement")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses the error dialog on Escape", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SolverStatusDialog status="error" message="boom" onDismiss={onDismiss} />);

    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss the solving dialog on Escape", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SolverStatusDialog status="solving" message={null} onDismiss={onDismiss} />);

    await user.keyboard("{Escape}");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses the error dialog on backdrop click, not on dialog-box click", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SolverStatusDialog status="error" message="boom" onDismiss={onDismiss} />);

    await user.click(screen.getByText("boom"));
    expect(onDismiss).not.toHaveBeenCalled();

    await user.click(screen.getByRole("presentation"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
