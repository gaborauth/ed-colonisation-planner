// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearConsentChoice, getConsentChoice, setConsentChoice } from "./consent";

beforeEach(() => {
  localStorage.clear();
});

describe("consent persistence", () => {
  it("returns null when no choice has ever been made", () => {
    expect(getConsentChoice()).toBeNull();
  });

  it("round-trips an accepted choice", () => {
    setConsentChoice("accepted");
    expect(getConsentChoice()).toBe("accepted");
  });

  it("round-trips a declined choice", () => {
    setConsentChoice("declined");
    expect(getConsentChoice()).toBe("declined");
  });

  it("clearConsentChoice resets back to null so the banner can be shown again", () => {
    setConsentChoice("declined");
    clearConsentChoice();
    expect(getConsentChoice()).toBeNull();
  });

  it("ignores garbage stored under the key rather than throwing", () => {
    localStorage.setItem("edcp:cookie-consent", "not-a-real-choice");
    expect(getConsentChoice()).toBeNull();
  });
});
