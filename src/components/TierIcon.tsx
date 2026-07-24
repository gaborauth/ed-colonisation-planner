interface TierIconProps {
  tier: 2 | 3;
}

/** Small marker for a T2/T3 points value, styled after the game's own in-cockpit icons: Tier 2 is
 * two yellow boxes stacked vertically, Tier 3 is three green boxes arranged in a triangle. Lets
 * the two numbers next to each other in the top bar read apart at a glance without spelling out
 * "T2"/"T3" every time. Purely decorative; the adjacent text already says which tier it is. */
export function TierIcon({ tier }: TierIconProps) {
  return (
    <span className={`tier-icon tier-icon-${tier}`} aria-hidden="true">
      <span className="tier-icon-box" />
      <span className="tier-icon-box" />
      {tier === 3 && <span className="tier-icon-box" />}
    </span>
  );
}
