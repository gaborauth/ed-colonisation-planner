// Google Analytics (gtag.js) loader — deliberately NOT wired into index.html as a static
// unconditional <script> tag, unlike Google's own copy-paste snippet. This app makes a point of
// being client-only/no-account/no-backend (see CLAUDE.md); the one deliberate exception to "no
// data leaves the browser unless the user asks" is this opt-in analytics tracker, so the script
// that actually talks to Google must never load until `loadGoogleAnalytics()` is explicitly called
// — which only happens after the user accepts via CookieConsentBanner.tsx (or immediately on a
// later page load if they'd already accepted previously, see persistence/consent.ts). Declining,
// or never answering, means literally zero requests to googletagmanager.com — no "Consent Mode
// default-denied still loads the script" middle ground, so there's nothing to explain about
// pre-consent cookieless pings.

export const GA_MEASUREMENT_ID = "G-N91B7P607V";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let loaded = false;

/** Idempotent — safe to call every time a page that already has consent mounts (StrictMode's
 * double-invoke included), without risking a duplicate <script> tag or a second `config` call. */
export function loadGoogleAnalytics(): void {
  if (loaded) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    ((...args: unknown[]): void => {
      window.dataLayer!.push(args);
    });
  const gtag = window.gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.onerror = () => {
    loaded = false;
  };
  document.head.appendChild(script);
  loaded = true;
}

/** Test-only escape hatch — `loaded` is deliberately module-scoped (not exported) so production
 * code can never accidentally reset it and re-trigger a duplicate load; tests need it to verify
 * idempotency across multiple `loadGoogleAnalytics()` calls without carrying state between them. */
export function _resetForTests(): void {
  loaded = false;
}
