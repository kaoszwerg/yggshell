import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import { parseChangelog, plain, type Line } from "../../lib/changelog";
import { useT } from "../../hooks/useT";

/**
 * What changed, in the app rather than only in the repository.
 *
 * The question "what did the update I just installed actually do?" is asked by people looking at the
 * app, not at a git history — so the answer belongs here, beside the version number they can see.
 */
export function Changelog() {
  const t = useT();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .changelog()
      .then((text) => {
        if (!cancelled) setLines(parseChangelog(text));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed !== null) {
    return <p className="text-danger text-xs">{t("about.changelogFailed", { reason: failed })}</p>;
  }
  if (lines === null) {
    return <p className="text-dim text-xs">{t("common.loading")}</p>;
  }

  return (
    <div className="max-h-96 overflow-auto pr-1 text-xs leading-relaxed">
      {lines.map((line, at) => {
        if (line.text === "") return <div key={at} className="h-2" />;
        if (line.kind === "release") {
          return (
            <h3 key={at} className="text-cyan mt-4 mb-1 font-mono text-[13px] first:mt-0">
              {plain(line.text)}
            </h3>
          );
        }
        if (line.kind === "section") {
          return (
            <h4 key={at} className="text-green mt-2 mb-1 font-mono text-[11px] tracking-wide">
              {plain(line.text)}
            </h4>
          );
        }
        if (line.kind === "item") {
          return (
            <p key={at} className="text-dim mb-1 pl-3 -indent-3">
              • {plain(line.text)}
            </p>
          );
        }
        return (
          <p key={at} className="text-dim">
            {plain(line.text)}
          </p>
        );
      })}
    </div>
  );
}
