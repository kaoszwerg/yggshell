import { useBuildInfo } from "../hooks/useBuildInfo";

/**
 * What this build actually is: version, channel, and the commit it came from (ADR-CORE-024).
 *
 * One source, because it used to be three — the About dialog, the old Home view and the status bar
 * each rendered their own copy of the same four fields, and a fourth caller would have made a fourth
 * (rule:reusability). The channel is coloured when it is a dev build: a version number alone does not
 * tell anyone that what they are looking at is not a release.
 */
export function BuildIdentity({ className = "" }: { className?: string }) {
  const { data: build } = useBuildInfo();

  const commit = build?.commit_date ? new Date(build.commit_date) : null;
  const commitDate = commit && !Number.isNaN(commit.getTime()) ? commit.toLocaleDateString() : "—";

  return (
    <dl
      className={`text-dim grid grid-cols-2 gap-x-4 gap-y-1.5 text-left font-mono text-xs ${className}`.trim()}
    >
      <Row label="version" value={build ? `v${build.version}` : "—"} />
      <div className="flex justify-between gap-2">
        <dt>channel</dt>
        <dd className={build?.channel === "dev" ? "text-gold" : "text-fg"}>
          {build?.channel ?? "—"}
        </dd>
      </div>
      {/* The dirty marker is the honest part: a build made from an edited tree is pinned to no
          commit at all, and quoting the SHA without it would be a claim that is not true. */}
      <Row label="commit" value={build ? `${build.git_sha}${build.git_dirty ? "+" : ""}` : "—"} />
      <Row label="commit date" value={commitDate} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}
