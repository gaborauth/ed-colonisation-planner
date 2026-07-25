import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import "./Tooltip.css";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Opt-in: also lets a click (or Enter/Space while focused) "pin" the bubble open regardless of
   * hover state, with the whole bubble becoming interactive while pinned instead of just hover-
   * previewable — see the doc comment below for why. Off by default, unchanged plain hover-preview
   * behavior: most current callers (e.g. `BuildingsTable`'s per-score-cell tooltip) have no
   * interactive content to reach and would gain nothing but an extra tab stop per cell from opting
   * in. The System facilities panel's body/facility "i" icons pass `pinnable` because their content
   * can include a real link. */
  pinnable?: boolean;
}

/** Hover-to-preview, click-to-pin info bubble. Plain hover (`hovered`) is transient exactly like
 * before: the bubble shows while the pointer or focus is on the icon and disappears the instant it
 * leaves. When `pinnable`, clicking (or Enter/Space while focused) additionally toggles `pinned`,
 * which keeps the bubble open regardless of hover state.
 *
 * Pinning exists because some bubble content now contains a real link (see SystemConfigPanel's
 * "Known issues" link) — without it, reaching the link meant crossing the visual gap between the
 * icon and the bubble (it's positioned `bottom: calc(100% + 8px)` away, not flush against it), and
 * that gap isn't part of the anchor's hoverable DOM subtree: the pointer passes over an unrelated
 * page element mid-transit, firing the anchor's `mouseleave` before the link is ever reachable.
 * Pinning sidesteps the gap entirely — clicking the icon itself needs no gap-crossing at all, and
 * once pinned the bubble stops depending on hover, so the pointer can wander freely (including
 * through the gap) without it closing. `.tooltip-bubble-pinned` (Tooltip.css) also makes the WHOLE
 * bubble interactive while pinned (not just links), so any content added there in the future gets
 * this for free.
 *
 * A pinned bubble closes on: clicking the icon or the bubble again (this same toggle — the whole
 * anchor subtree shares one `onClick`), or clicking anywhere outside it (a `mousedown` listener on
 * `document`, standard popover convention, mainly so it can't get stuck open) — never on plain
 * mouse-out, since staying open through that is the entire point. */
export function Tooltip({ content, children, pinnable = false }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const isPinned = pinnable && pinned;
  const visible = hovered || isPinned;

  useEffect(() => {
    if (!isPinned) return;
    function handleOutsideClick(event: MouseEvent): void {
      if (!anchorRef.current?.contains(event.target as Node)) setPinned(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isPinned]);

  function togglePinned(): void {
    setPinned((p) => !p);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePinned();
    }
  }

  return (
    <span
      ref={anchorRef}
      className={`tooltip-anchor${isPinned ? " tooltip-anchor-pinned" : ""}`}
      role={pinnable ? "button" : undefined}
      tabIndex={pinnable ? 0 : undefined}
      aria-pressed={pinnable ? pinned : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={pinnable ? togglePinned : undefined}
      onKeyDown={pinnable ? handleKeyDown : undefined}
    >
      {children}
      {visible && (
        <span className={`tooltip-bubble${isPinned ? " tooltip-bubble-pinned" : ""}`}>
          {content}
          {isPinned && <span className="tooltip-pinned-hint">Pinned — click to close</span>}
        </span>
      )}
    </span>
  );
}
