import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Download } from "lucide-react";
import { Button } from "../ui/Button";
import { useAgentAttention } from "../../hooks/useAgentAttention";
import { useT } from "../../hooks/useT";
import { useTerminalStore } from "../../store/terminal";
import { environmentApi } from "../../api/environment";

/**
 * Which agents are asking for something, and the button that makes them able to.
 *
 * **The precise half of the attention signal.** The terminal bell says *something happened
 * somewhere* — kept, because it is the only signal that survives tmux and works for every program.
 * This says *which directory* and *why*, which is what turns "a tab rang" into "tab 3 wants a
 * permission".
 *
 * **It takes effect in the next session**, and the panel says so. Claude Code reads its hooks when a
 * session starts; without that sentence the button looks like it did nothing.
 */
export function AttentionPanel() {
  const t = useT();
  const { installed, waiting, ready } = useAgentAttention();
  const cwd = useTerminalStore((s) => s.panes.find((p) => p.key === s.activeKey)?.cwd ?? null);
  const client = useQueryClient();

  const install = useMutation({
    mutationFn: () =>
      cwd === null ? Promise.reject(new Error("no directory")) : environmentApi.installHook(cwd),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agent-attention"] }),
  });

  const clear = useMutation({
    mutationFn: () => environmentApi.clearAttention(),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agent-attention"] }),
  });

  if (!ready) return null;

  return (
    <section className="border-cyan/15 flex flex-col gap-1.5 border-t px-2 py-2">
      <h3 className="text-dim font-mono text-[0.56rem] tracking-[0.12em]">
        {t("attention.title").toUpperCase()}
      </h3>

      {installed ? null : (
        <>
          <p className="text-dim font-mono text-[10px] leading-relaxed">{t("attention.explain")}</p>
          <Button
            onClick={() => install.mutate()}
            disabled={install.isPending}
            className="self-start"
          >
            <Download size={11} aria-hidden />
            {t("attention.install")}
          </Button>
        </>
      )}

      {installed && install.isSuccess ? (
        // Said once, and it is the sentence that matters: hooks are read when a session starts.
        <p className="text-gold font-mono text-[10px]">{t("attention.nextSession")}</p>
      ) : null}

      {installed && waiting.length === 0 ? (
        <p className="text-dim flex items-center gap-1.5 font-mono text-[10px]">
          <Check size={11} className="text-green shrink-0" aria-hidden />
          {t("attention.none")}
        </p>
      ) : null}

      {waiting.map((item, at) => (
        <div key={`${item.cwd}:${at}`} className="flex items-start gap-1.5" data-idle={item.idle}>
          {/* Green for "finished", gold for "something is blocked on you" — the same two meanings the
              tab's dot carries, from the same decision (`lib/bells`). */}
          <BellRing
            size={11}
            className={`mt-0.5 shrink-0 ${item.idle ? "text-green" : "text-gold"}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-fg truncate font-mono text-[10px]" dir="rtl">
              {item.cwd}
            </p>
            {/* OUR wording for an idle prompt, not the harness's. It sends "Claude is waiting for
                your input", which reads as a question and is not one — it is a timer noticing the
                prompt has sat empty since the agent finished. Repeating it verbatim is how the panel
                came to say "waiting for you" about something that wanted nothing. A real request
                keeps its own message, because that one does say something. */}
            <p className="text-dim font-mono text-[10px]">
              {item.idle ? t("attention.finished") : (item.message ?? t("attention.asking"))}
            </p>
          </div>
        </div>
      ))}

      {waiting.length === 0 ? null : (
        <Button onClick={() => clear.mutate()} className="self-start">
          {t("attention.clear")}
        </Button>
      )}
    </section>
  );
}
