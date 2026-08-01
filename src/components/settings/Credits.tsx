import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import { useT } from "../../hooks/useT";
import { Markdown } from "../ui/Markdown";

/**
 * The licence notices of everything bundled with the app.
 *
 * **Here because MIT says so.** Every ported colour scheme carries a licence requiring its copyright
 * notice to travel with the copy — and the schemes shipped inside the binary while the notice stayed
 * in the repository. A file nobody who installs the app can read does not satisfy that.
 *
 * Rendered as the markdown it is — it has a table of upstreams and licences in it, and as raw text
 * that is a wall of pipes. The renderer keeps anything it does not understand as a paragraph rather
 * than dropping it, because a licence notice that quietly loses a line is the defect this exists to
 * prevent (`lib/markdown`).
 */
export function Credits() {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .bundledCredits()
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((error: unknown) => {
        // Reported, never silently blank: an empty licence panel looks like "nothing to credit",
        // which is the opposite of true (rule:logging — no silent failures).
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed !== null) {
    return <p className="text-danger text-xs">{t("about.creditsFailed", { reason: failed })}</p>;
  }
  if (text === null) {
    return <p className="text-dim text-xs">{t("common.loading")}</p>;
  }

  return <Markdown source={text} className="max-h-96 overflow-auto pr-1" />;
}
