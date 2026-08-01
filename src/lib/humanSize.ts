/**
 * A byte count a person can read at a glance.
 *
 * Not localised on purpose: `kB`/`MB` are the same in both languages this app speaks, and a
 * translated unit next to an untranslated one would look like a bug (rule:i18n).
 */
export function humanSize(bytes: number | bigint): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = n / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // One decimal below 10, none above: "1.4 MB" is useful, "148.3 MB" is noise.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units.at(unit) ?? "kB"}`;
}
