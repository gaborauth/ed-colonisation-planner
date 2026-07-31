import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type SetStateAction } from "react";

/** `setCollapsed`'s own type, not React's plain `Dispatch<SetStateAction<boolean>>` — the second,
 * optional `compensate` param (default `true`) is the escape hatch a caller uses when it wants the
 * collapse to happen WITHOUT the anchoring scroll compensation below (see `setCollapsed`'s doc
 * comment for when that's correct). */
export type SetCollapsed = (next: SetStateAction<boolean>, options?: { compensate?: boolean }) => void;

/** A `useState<boolean>`-alike for a foldable panel's collapsed flag, except every state change —
 * a manual toggle-button click OR a programmatic one (e.g. SystemConfigPanel's auto-fold-on-solve) —
 * keeps the panel's own toggle button anchored at the same on-screen position, UNLESS the caller
 * explicitly opts out via `setCollapsed(next, { compensate: false })`. Folding a tall panel (the
 * body tree, the buildings table, ...) removes a lot of document height below the toggle button;
 * with `window.scrollY` otherwise untouched, the browser is often forced to CLAMP it down because
 * the document just got shorter than the old scroll position — yanking the toggle button (and
 * whatever else was visible) to a completely different spot instead of leaving it where the user
 * was already looking. Fixed by measuring the toggle button's `getBoundingClientRect().top` right
 * before the state change, then again right after the DOM has re-rendered to match (`useLayoutEffect`
 * fires before the browser paints, so there's no visible flash of the wrong position), and scrolling
 * by exactly the difference. Attach `buttonRef` to the `<button className="panel-toggle">` element —
 * NOT the whole `<section>` — since the button is the one fixed point guaranteed to still exist,
 * unmoved by its OWN panel's content collapsing, whose viewport position only changes when
 * `window.scrollY` itself got involuntarily clamped.
 *
 * `compensate: false` exists for exactly one known case so far: `SystemConfigPanel`'s auto-collapse
 * on solve completion, which races against `App.tsx`'s own `scrollIntoView` to "Solved system" —
 * the anchor compensation here is correct for a user clicking a button they're looking at, but
 * actively wrong for a collapse the solve flow triggers programmatically while the page is already
 * about to scroll elsewhere; the two competing scroll adjustments landed the viewport in the wrong
 * place more often than not. */
export function useScrollAnchoredCollapse<T extends HTMLElement>(
  initial: boolean,
): { collapsed: boolean; setCollapsed: SetCollapsed; buttonRef: RefObject<T | null> } {
  const [collapsed, setCollapsedState] = useState(initial);
  const buttonRef = useRef<T>(null);
  const beforeTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (beforeTop.current === null || !buttonRef.current) return;
    const afterTop = buttonRef.current.getBoundingClientRect().top;
    const delta = afterTop - beforeTop.current;
    if (delta !== 0) window.scrollBy(0, delta);
    beforeTop.current = null;
  }, [collapsed]);

  // Wrapped in useCallback with an empty dep array (not just an inline arrow function) so this has
  // the same STABLE identity across renders a real `useState` setter has — otherwise every
  // consumer's `useEffect([justSolved])`-style calls would need `setCollapsed` added to their own
  // dependency array (react-hooks/exhaustive-deps), which would then fire on every render instead
  // of only when the effect's real trigger changes. Safe as an empty-deps callback: it only reads
  // ref objects (`buttonRef`, `beforeTop`) and calls the real `setCollapsedState` setter, both
  // stable regardless of when this closure was created — no stale-closure risk.
  const setCollapsed: SetCollapsed = useCallback((next, options) => {
    // Leaving `beforeTop.current` at `null` is what makes the layout effect above skip the
    // compensating `scrollBy` entirely (its own early-return) — not a separate flag to thread
    // through the effect.
    if (options?.compensate !== false && buttonRef.current) {
      beforeTop.current = buttonRef.current.getBoundingClientRect().top;
    }
    setCollapsedState(next);
  }, []);

  return { collapsed, setCollapsed, buttonRef };
}
