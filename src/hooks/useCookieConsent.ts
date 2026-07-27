import { useEffect, useState } from "react";
import { loadGoogleAnalytics } from "../analytics/gtag";
import { clearConsentChoice, getConsentChoice, setConsentChoice, type ConsentChoice } from "../persistence/consent";

/** Owns the cookie-consent choice/banner-open state so both `CookieConsentBanner` (the dialog) and
 * `Footer` (the persistent "Cookie settings" reopen link, moved into the footer's row alongside
 * version/GitHub/BMC — 2026-07-27 user request) can read and change the same state; a single
 * component owning both pieces stopped being possible once the reopen link moved out of
 * `CookieConsentBanner.tsx` into a separate component. Called once in `App.tsx`, same pattern as
 * `plannerReducer`/`resultState` living there and being passed down as props. */
export function useCookieConsent() {
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

  return { choice, bannerOpen, accept, decline, reopen };
}
