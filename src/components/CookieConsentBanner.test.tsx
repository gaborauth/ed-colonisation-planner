// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, GA_MEASUREMENT_ID } from "../analytics/gtag";
import { getConsentChoice, setConsentChoice } from "../persistence/consent";
import { CookieConsentBanner } from "./CookieConsentBanner";

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

describe("CookieConsentBanner", () => {
  it("shows the banner on first visit, before any choice is made — and loads nothing yet", () => {
    render(<CookieConsentBanner />);
    expect(screen.getByRole("dialog", { name: "Cookie consent" })).toBeInTheDocument();
    expect(gaScriptTag()).toBeNull();
  });

  it("accepting persists the choice, hides the banner, and loads Google Analytics", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(getConsentChoice()).toBe("accepted");
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).not.toBeInTheDocument();
    expect(gaScriptTag()).not.toBeNull();
    expect(screen.getByRole("button", { name: /Cookie settings/ })).toBeInTheDocument();
  });

  it("declining persists the choice, hides the banner, and never loads Google Analytics", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);
    await user.click(screen.getByRole("button", { name: "Decline" }));

    expect(getConsentChoice()).toBe("declined");
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).not.toBeInTheDocument();
    expect(gaScriptTag()).toBeNull();
  });

  it("a returning visitor who previously accepted gets Analytics loaded automatically, no banner shown", () => {
    setConsentChoice("accepted");
    render(<CookieConsentBanner />);
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).not.toBeInTheDocument();
    expect(gaScriptTag()).not.toBeNull();
  });

  it("a returning visitor who previously declined sees no banner and nothing loads", () => {
    setConsentChoice("declined");
    render(<CookieConsentBanner />);
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).not.toBeInTheDocument();
    expect(gaScriptTag()).toBeNull();
  });

  it("the persistent 'Cookie settings' link reopens the banner and clears the stored choice", async () => {
    const user = userEvent.setup();
    setConsentChoice("declined");
    render(<CookieConsentBanner />);
    await user.click(screen.getByRole("button", { name: /Cookie settings/ }));

    expect(screen.getByRole("dialog", { name: "Cookie consent" })).toBeInTheDocument();
    expect(getConsentChoice()).toBeNull();
  });
});
