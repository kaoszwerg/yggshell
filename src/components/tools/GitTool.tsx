import { GitBranch } from "lucide-react";

/**
 * The Git tool — the reason the tool column exists (mem:project-scope): watching a repository change
 * while the harness in the terminal works on it.
 *
 * **Not wired to a repository yet, on purpose.** How the app learns *which* repository is an open
 * decision the maintainer has not made: the shell reporting its working directory over OSC 7, the
 * backend querying the child process's cwd per platform, or an explicitly chosen folder. Each has a
 * different cost and a different failure mode, and picking one here would have been picking it for
 * them.
 *
 * So this says what it is waiting for rather than rendering an invented branch. An empty state that
 * names the missing piece is honest; a fake one is a lie that survives until someone trusts it.
 */
export function GitTool() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <GitBranch className="text-cyan/30" size={32} strokeWidth={1.25} aria-hidden />
      <p className="text-dim font-mono text-xs leading-relaxed">
        No repository connected.
        <br />
        <span className="text-dim/70">
          How the app finds one is still to be decided — see ADR-PROJ-001.
        </span>
      </p>
    </div>
  );
}
