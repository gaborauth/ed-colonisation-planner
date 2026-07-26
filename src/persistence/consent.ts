// Cookie/analytics consent choice — localStorage-backed, same "stateless (no backend), not
// state-free" spirit as plans.ts/journalSystems.ts. Kept separate from analytics/gtag.ts (which
// only knows how to load the Google Analytics script, not whether it's allowed to) so the consent
// *decision* and the *effect* of that decision stay independently testable.

const STORAGE_KEY = "edcp:cookie-consent";

export type ConsentChoice = "accepted" | "declined";

/** `null` means no choice has ever been made — distinct from `"declined"`, which is an explicit
 * opt-out. `CookieConsentBanner.tsx` only shows the banner for the `null` case. */
export function getConsentChoice(): ConsentChoice | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "accepted" || raw === "declined" ? raw : null;
}

export function setConsentChoice(choice: ConsentChoice): void {
  localStorage.setItem(STORAGE_KEY, choice);
}

/** Lets a user withdraw a previous choice entirely (distinct from re-declining) — GDPR requires
 * revoking consent be as easy as giving it; `CookieConsentBanner.tsx`'s persistent "Cookie
 * settings" link uses this to bring the banner back rather than just re-showing it with the old
 * choice pre-applied. */
export function clearConsentChoice(): void {
  localStorage.removeItem(STORAGE_KEY);
}
