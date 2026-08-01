import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import { Markdown } from "../ui/Markdown";
import { useT } from "../../hooks/useT";

/**
 * What changed, in the app rather than only in the repository.
 *
 * The question "what did the update I just installed actually do?" is asked by people looking at the
 * app, not at a git history — so the answer belongs here, beside the version number they can see.
 */
export function Changelog() {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .changelog()
      .then((value) => {
        if (!cancelled) setText(value);
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
  if (text === null) {
    return <p className="text-dim text-xs">{t("common.loading")}</p>;
  }

  return <Markdown source={text} className="max-h-96 overflow-auto pr-1" />;
}
