// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollAnchoredCollapse } from "./useScrollAnchoredCollapse";

// jsdom's own `getBoundingClientRect` always returns an all-zero rect (no real layout engine), so
// these tests fake it explicitly to simulate a toggle button's on-screen position actually shifting
// between the "before" and "after" measurement `setCollapsed`/its layout effect take.
function fakeRect(top: number): DOMRect {
  return { top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
}

function attachButton(): HTMLButtonElement {
  const button = document.createElement("button");
  document.body.appendChild(button);
  return button;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useScrollAnchoredCollapse", () => {
  it("compensates window.scrollBy by the toggle button's own position delta by default", () => {
    const { result } = renderHook(() => useScrollAnchoredCollapse<HTMLButtonElement>(false));
    const button = attachButton();
    act(() => {
      result.current.buttonRef.current = button;
    });
    const rect = vi
      .spyOn(button, "getBoundingClientRect")
      .mockReturnValueOnce(fakeRect(100)) // measured inside setCollapsed, before the state change
      .mockReturnValueOnce(fakeRect(40)); // measured again by the layout effect, after the button moved
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    act(() => result.current.setCollapsed(true));

    expect(rect).toHaveBeenCalledTimes(2);
    expect(scrollBy).toHaveBeenCalledWith(0, -60);
  });

  it("skips the scrollBy compensation entirely when compensate: false — the fix for the auto-collapse-on-solve race against App.tsx's own scrollIntoView", () => {
    const { result } = renderHook(() => useScrollAnchoredCollapse<HTMLButtonElement>(false));
    const button = attachButton();
    act(() => {
      result.current.buttonRef.current = button;
    });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(fakeRect(100));
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    act(() => result.current.setCollapsed(true, { compensate: false }));

    expect(scrollBy).not.toHaveBeenCalled();
    expect(result.current.collapsed).toBe(true);
  });
});
