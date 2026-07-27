// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, GA_MEASUREMENT_ID } from "../analytics/gtag";
import { getConsentChoice, setConsentChoice } from "../persistence/consent";
import { useCookieConsent } from "./useCookieConsent";

function gaScriptTag(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>(
    `script[src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`,
  );
}

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete window.gtag;
});

describe("useCookieConsent", () => {
  it("opens the banner on first visit, before any choice is made — and loads nothing yet", () => {
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current.bannerOpen).toBe(true);
    expect(result.current.choice).toBeNull();
    expect(gaScriptTag()).toBeNull();
  });

  it("accepting persists the choice, closes the banner, and loads Google Analytics", () => {
    const { result } = renderHook(() => useCookieConsent());
    act(() => result.current.accept());

    expect(getConsentChoice()).toBe("accepted");
    expect(result.current.bannerOpen).toBe(false);
    expect(result.current.choice).toBe("accepted");
    expect(gaScriptTag()).not.toBeNull();
  });

  it("declining persists the choice, closes the banner, and never loads Google Analytics", () => {
    const { result } = renderHook(() => useCookieConsent());
    act(() => result.current.decline());

    expect(getConsentChoice()).toBe("declined");
    expect(result.current.bannerOpen).toBe(false);
    expect(result.current.choice).toBe("declined");
    expect(gaScriptTag()).toBeNull();
  });

  it("a returning visitor who previously accepted gets Analytics loaded automatically, no banner shown", () => {
    setConsentChoice("accepted");
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current.bannerOpen).toBe(false);
    expect(gaScriptTag()).not.toBeNull();
  });

  it("a returning visitor who previously declined sees no banner and nothing loads", () => {
    setConsentChoice("declined");
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current.bannerOpen).toBe(false);
    expect(gaScriptTag()).toBeNull();
  });

  it("reopen clears the stored choice and opens the banner again", () => {
    setConsentChoice("declined");
    const { result } = renderHook(() => useCookieConsent());
    act(() => result.current.reopen());

    expect(result.current.bannerOpen).toBe(true);
    expect(getConsentChoice()).toBeNull();
  });
});
