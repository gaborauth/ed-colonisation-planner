import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
  /** Extra class(es) on the anchor `<span>`, alongside `tooltip-anchor` — e.g. so a full-width
   * child (like `EconomyMixBar`) gets a `display: block; width: 100%` anchor instead of the default
   * `inline-block` (which shrink-to-fits, collapsing a `width: 100%` child's percentage basis to
   * nothing). Same idea as the existing `td .tooltip-anchor` override below, generalized for
   * non-table use sites. */
  anchorClassName?: string;
  /** Inline style merged onto the anchor `<span>` — e.g. `EconomyMixBar`'s per-segment tooltips need
   * the anchor itself to BE the properly-sized flex item (`flexGrow`/`flexBasis`/`minWidth`), since
   * those only take effect on a direct child of the flex container; wrapping a segment in `Tooltip`
   * otherwise interposes the anchor `<span>` between the flex container and the sized segment,
   * breaking the layout. Inline style also wins over `.tooltip-anchor`'s own `display: inline-block`
   * outright, so `anchorClassName`'s block/width override isn't needed alongside a `display` set
   * here too. */
  anchorStyle?: CSSProperties;
  /** Accessible name for the anchor `<span>` — needed whenever `children` itself carries no
   * accessible name a screen reader could pick up (e.g. `EconomyMixBar`'s root is `aria-hidden`,
   * so a pinnable Tooltip wrapping it would otherwise expose a silent, unlabeled `role="button"`;
   * compare `FacilityInfoIcon`'s own pattern, which labels its non-hidden icon `<span>` directly
   * instead — this prop covers the case where that's not an option). */
  anchorLabel?: string;
  /** Set to `false` to suppress the hover-preview behavior entirely, showing the bubble ONLY when
   * pinned (requires `pinnable`). Default `true` (unchanged behavior for every other caller).
   * `EconomyMixBar`'s system-wide sum bar uses this: its own per-segment child tooltips already
   * answer "what's this stripe" on hover, so also hover-previewing the OUTER aggregate bubble at
   * the same time would show two overlapping bubbles for the same pointer position — click-only
   * keeps the two mutually exclusive. */
  hoverPreview?: boolean;
}

/** Hover-to-preview, click-to-pin info bubble. Plain hover (`hovered`) is always transient: the
 * bubble shows while the pointer or focus is on the icon and disappears the instant it leaves,
 * regardless of whether `pinnable` is set. When `pinnable`, clicking (or Enter/Space while
 * focused) additionally toggles `pinned`, which keeps the bubble open regardless of hover state.
 *
 * Pinning exists because some bubble content contains a real link (see SystemConfigPanel's
 * "Known issues" link) — without it, reaching the link means crossing the visual gap between the
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
export function Tooltip({
  content,
  children,
  pinnable = false,
  anchorClassName,
  anchorStyle,
  anchorLabel,
  hoverPreview = true,
}: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const isPinned = pinnable && pinned;
  const visible = (hoverPreview && hovered) || isPinned;

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
      className={`tooltip-anchor${isPinned ? " tooltip-anchor-pinned" : ""}${anchorClassName ? ` ${anchorClassName}` : ""}`}
      style={anchorStyle}
      aria-label={anchorLabel}
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
