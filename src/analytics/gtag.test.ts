// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, GA_MEASUREMENT_ID, loadGoogleAnalytics } from "./gtag";

beforeEach(() => {
  _resetForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete window.dataLayer;
  delete window.gtag;
});

describe("loadGoogleAnalytics", () => {
  it("injects the gtag.js script tag pointed at the real measurement ID", () => {
    loadGoogleAnalytics();
    const script = document.head.querySelector<HTMLScriptElement>(
      `script[src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`,
    );
    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
  });

  it("pushes the js/config calls onto window.dataLayer", () => {
    loadGoogleAnalytics();
    expect(window.dataLayer).toBeDefined();
    const calls = window.dataLayer!.map((args) => (args as unknown[])[0]);
    expect(calls).toContain("js");
    expect(calls).toContain("config");
  });

  it("exposes window.gtag and routes later calls into dataLayer", () => {
    loadGoogleAnalytics();
    window.gtag?.("event", "test_event");
    const calls = window.dataLayer!.map((args) => args as unknown[]);
    expect(calls.some((call) => call[0] === "event" && call[1] === "test_event")).toBe(true);
  });

  it("is idempotent — a second call doesn't inject a duplicate script tag", () => {
    loadGoogleAnalytics();
    loadGoogleAnalytics();
    const scripts = document.head.querySelectorAll(
      `script[src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`,
    );
    expect(scripts).toHaveLength(1);
  });
});
