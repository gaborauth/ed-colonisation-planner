/** GDPR-style cookie consent bar — see analytics/gtag.ts's header comment for why this app treats
 * "no choice yet" and "declined" identically (zero requests to Google) rather than the more common
 * "load analytics with consent-mode-denied by default" pattern. Shown once, on first visit, until
 * a choice is made. The consent state itself (and the "Cookie settings" reopen link, now in
 * Footer.tsx's row alongside version/GitHub/BMC — 2026-07-27 user request) lives in App.tsx, since
 * both this dialog and the footer's link need to see and change the same choice/open state. */
export function CookieConsentBanner({
  open,
  onAccept,
  onDecline,
}: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (!open) return null;

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
        <button type="button" onClick={onDecline}>
          Decline
        </button>
        <button type="button" className="primary" onClick={onAccept}>
          Accept
        </button>
      </div>
    </div>
  );
}
