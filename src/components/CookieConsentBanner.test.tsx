// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CookieConsentBanner } from "./CookieConsentBanner";

describe("CookieConsentBanner", () => {
  it("renders the dialog when open", () => {
    render(<CookieConsentBanner open onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Cookie consent" })).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<CookieConsentBanner open={false} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).not.toBeInTheDocument();
  });

  it("clicking Accept calls onAccept", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<CookieConsentBanner open onAccept={onAccept} onDecline={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("clicking Decline calls onDecline", async () => {
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(<CookieConsentBanner open onAccept={vi.fn()} onDecline={onDecline} />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });
});
