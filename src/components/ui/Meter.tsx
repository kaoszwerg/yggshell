/**
 * A filled bar for a value that has a real maximum.
 *
 * **Only where a denominator genuinely exists.** The context count deliberately has no bar
 * (`lib/tokens`): the transcript never records the size of the window, so a bar would be drawn
 * against a guess. Subscription limits *are* reported as percentages, so a bar is the honest shape
 * for them and a number alone would waste what is known.
 *
 * The colour is part of the reading: a limit nine tenths gone means something different from one a
 * quarter gone, and making the eye compare two numbers to notice that is work the interface can do.
 */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  // Thresholds, not a gradient: the point is to be readable at a glance rather than to encode the
  // exact number twice.
  const fill =
    clamped >= 90
      ? "bg-danger"
      : clamped >= 70
        ? "bg-gold"
        : clamped >= 40
          ? "bg-cyan"
          : "bg-green";

  return (
    <div
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="bg-elevated hud-clip-sm h-1.5 w-full overflow-hidden"
    >
      <div
        className={`h-full ${fill} transition-[width] duration-500`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
