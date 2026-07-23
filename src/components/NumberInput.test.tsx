// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { NumberInput } from "./NumberInput";

function Harness(props: Partial<Parameters<typeof NumberInput>[0]> = {}) {
  const [value, setValue] = useState<number | undefined>(props.value);
  return <NumberInput value={value} onChange={setValue} ariaLabel="qty" {...props} />;
}

describe("NumberInput", () => {
  it("allows a lone leading '-' while typing without committing a value yet", async () => {
    const user = userEvent.setup();
    render(<Harness allowNegative />);
    const input = screen.getByLabelText("qty");
    await user.type(input, "-");
    expect(input).toHaveValue("-");
  });

  it("normalizes a lone '-' to blank on blur (blankMeans: undefined)", async () => {
    const user = userEvent.setup();
    render(<Harness allowNegative />);
    const input = screen.getByLabelText("qty");
    await user.type(input, "-");
    await user.tab();
    expect(input).toHaveValue("");
  });

  it("normalizes blank to 0 on blur when blankMeans is 'zero'", async () => {
    const user = userEvent.setup();
    render(<Harness blankMeans="zero" value={5} />);
    const input = screen.getByLabelText("qty");
    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue("0");
  });

  it("rejects non-numeric characters", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("qty");
    await user.type(input, "12a3");
    expect(input).toHaveValue("123");
  });

  it("rejects '-' when negatives are not allowed", async () => {
    const user = userEvent.setup();
    render(<Harness allowNegative={false} />);
    const input = screen.getByLabelText("qty");
    await user.type(input, "-5");
    expect(input).toHaveValue("5");
  });
});
