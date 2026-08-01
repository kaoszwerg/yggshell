import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import { useT } from "../../hooks/useT";

/**
 * The licence notices of everything bundled with the app.
 *
 * **Here because MIT says so.** Every ported colour scheme carries a licence requiring its copyright
 * notice to travel with the copy — and the schemes shipped inside the binary while the notice stayed
 * in the repository. A file nobody who installs the app can read does not satisfy that.
 *
 * Rendered as the plain text it is, rather than parsed into markup: it is a licence notice, its
 * wording is the thing that matters, and a renderer that dropped a line would be the defect this
 * exists to prevent.
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

  return (
    <pre className="text-dim max-h-96 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
      {text}
    </pre>
  );
}
