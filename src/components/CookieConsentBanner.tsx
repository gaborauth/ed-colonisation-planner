import { useEffect, useState } from "react";
import { loadGoogleAnalytics } from "../analytics/gtag";
import { clearConsentChoice, getConsentChoice, setConsentChoice, type ConsentChoice } from "../persistence/consent";

/** GDPR-style cookie consent bar — see analytics/gtag.ts's header comment for why this app treats
 * "no choice yet" and "declined" identically (zero requests to Google) rather than the more common
 * "load analytics with consent-mode-denied by default" pattern. Shown once, on first visit, until
 * a choice is made; a small persistent "Cookie settings" link (rendered whenever the banner itself
 * isn't) lets the user reopen it later to change their mind either direction. */
export function CookieConsentBanner() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  useEffect(() => {
    const existing = getConsentChoice();
    setChoice(existing);
    setBannerOpen(existing === null);
    if (existing === "accepted") loadGoogleAnalytics();
  }, []);

  function accept(): void {
    setConsentChoice("accepted");
    setChoice("accepted");
    setBannerOpen(false);
    loadGoogleAnalytics();
  }

  function decline(): void {
    setConsentChoice("declined");
    setChoice("declined");
    setBannerOpen(false);
  }

  function reopen(): void {
    clearConsentChoice();
    setBannerOpen(true);
  }

  if (!bannerOpen) {
    return (
      <button type="button" className="cookie-settings-link" onClick={reopen}>
        Cookie settings{choice ? ` (${choice})` : ""}
      </button>
    );
  }

  return (
    <div className="cookie-consent-banner" role="dialog" aria-label="Cookie consent">
      <p>
        This site can use Google Analytics to see how it's used (page views only — no accounts, no personal data
        collected by this app itself). It's off by default and only turns on if you accept.{" "}
        <a href="privacy.html" target="_blank" rel="noreferrer">
          Privacy details
        </a>
        .
      </p>
      <div className="cookie-consent-actions">
        <button type="button" onClick={decline}>
          Decline
        </button>
        <button type="button" className="primary" onClick={accept}>
          Accept
        </button>
      </div>
    </div>
  );
}
