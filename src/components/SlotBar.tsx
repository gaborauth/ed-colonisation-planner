interface SlotBarProps {
  built: number;
  total: number;
}

/** Small horizontal fill bar for a "built X / free Y of total Z" slot-usage line — the colored
 * portion is `built`, the dim remainder is `free`. Tints red once there's no free capacity left
 * (a quick "this pool is full" cue), accent otherwise. Purely decorative (the numbers next to it
 * carry the actual info) — hidden from assistive tech via the title tooltip on its container. */
export function SlotBar({ built, total }: SlotBarProps) {
  const pct = total > 0 ? Math.min(100, (built / total) * 100) : 0;
  const free = Math.max(0, total - built);
  return (
    <span
      className={`slot-bar${free === 0 && total > 0 ? " slot-bar-full" : ""}`}
      title={`${built} built / ${free} free of ${total}`}
      aria-hidden="true"
    >
      <span className="slot-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
