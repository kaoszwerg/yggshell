import {
  Activity,
  Bot,
  Box,
  FolderTree,
  GitBranch,
  ScrollText,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { Layers, NotebookPen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import type { HudAccent } from "../ui/hudButton";
import { useUiStore, type ToolId, type ViewId } from "../../store/ui";
import { useT } from "../../hooks/useT";
import type { MessageKey } from "../../i18n";

type NavItem = { id: ViewId; Icon: LucideIcon; label: MessageKey };
type ToolItem = { id: ToolId; Icon: LucideIcon; label: MessageKey };

const MAIN_NAV: NavItem[] = [{ id: "terminal", Icon: TerminalSquare, label: "nav.terminal" }];

/** Tools open the column beside this rail. They never replace what is on screen — that is what a view
 *  does, and the difference is the reason the column exists. */
/**
 * The tools, in the order they are reached for.
 *
 * Git and Files first and unmoved — they are about the code in front of you, they are what the
 * column was built for, and their position is muscle memory by now. Then Agent, which is about the
 * work being done to that code; then Activity and Docker, which are about the machine it runs on.
 * The rail reads from "what am I editing" outwards to "what is this box doing", which is the order
 * somebody actually asks those questions in.
 */
const TOOLS: ToolItem[] = [
  { id: "git", Icon: GitBranch, label: "nav.git" },
  { id: "files", Icon: FolderTree, label: "nav.files" },
  { id: "agent", Icon: Bot, label: "nav.agent" },
  { id: "activity", Icon: Activity, label: "nav.activity" },
  { id: "docker", Icon: Box, label: "nav.docker" },
  { id: "tmux", Icon: Layers, label: "nav.tmux" },
  { id: "notes", Icon: NotebookPen, label: "nav.notes" },
];

const BOTTOM_NAV: NavItem[] = [
  { id: "logs", Icon: ScrollText, label: "nav.logs" },
  { id: "settings", Icon: Settings, label: "nav.settings" },
];

/**
 * Left HUD rail. **Navigation only** — nothing renders its content here.
 *
 * Two kinds of entry, and the distinction is the point: a *view* replaces what you are looking at
 * (Terminal, Logs, Settings), a *tool* opens the resizable column next to the rail and leaves the
 * terminal running beside it. Clicking the active tool again collapses that column.
 */
export function Sidebar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const activeTool = useUiStore((s) => s.activeTool);
  const toggleTool = useUiStore((s) => s.toggleTool);
  const t = useT();

  return (
    <nav
      className="hud-strip flex w-14 shrink-0 flex-col items-center gap-1.5 py-2"
      style={{
        borderRight: "1px solid rgb(var(--saga-neon-cyan-rgb) / 0.3)",
        borderBottom: "none",
      }}
      aria-label={t("nav.primary")}
    >
      {MAIN_NAV.map((item) => (
        <RailButton
          key={item.id}
          Icon={item.Icon}
          label={t(item.label)}
          active={view === item.id}
          // Cyan at rest, green where you ARE. Green is a state, not a label — a permanent green
          // rail would say "you are here" about five places at once.
          accent={view === item.id ? "green" : "cyan"}
          current={view === item.id ? "page" : undefined}
          onClick={() => setView(item.id)}
        />
      ))}

      <span aria-hidden className="bg-cyan/20 my-1 h-px w-7 shrink-0" />

      {TOOLS.map((tool) => (
        <RailButton
          key={tool.id}
          Icon={tool.Icon}
          label={t(tool.label)}
          active={activeTool === tool.id}
          // `page` would be a lie: a tool does not replace the page, it opens beside it. `pressed`
          // is what a toggle says, and this button is a toggle.
          pressed={activeTool === tool.id}
          // Purple, and not by taste: it is the one accent in the palette that carries no other
          // meaning here. Green already says "this is the view you are in", gold is reserved for
          // warnings and the DEV badge, and danger is destructive. A tool is a different KIND of
          // thing from a view — it opens beside what you are doing instead of replacing it — so it
          // reads as different at a glance rather than as another view that happens to be off.
          accent="purple"
          onClick={() => toggleTool(tool.id)}
        />
      ))}

      <div className="flex-1" />

      {BOTTOM_NAV.map((item) => (
        <RailButton
          key={item.id}
          Icon={item.Icon}
          label={t(item.label)}
          active={view === item.id}
          // Logs and Settings are views like any other — same rule as the nav above.
          accent={view === item.id ? "green" : "cyan"}
          current={view === item.id ? "page" : undefined}
          onClick={() => setView(item.id)}
        />
      ))}
    </nav>
  );
}

/** One rail entry, drawn as a HUD `IconButton` (ADR-APP-026): the label is the accessible name and the
 * hover tooltip (replacing the native `title`); the active entry fills green. */
function RailButton({
  Icon,
  label,
  active,
  current,
  pressed,
  accent,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  current?: "page";
  pressed?: boolean;
  /** The colour this entry fills with when it is on. Views are green; tools are purple. */
  /** Worn at rest as well as when active — the rail's kinds have to be told apart before you pick. */
  accent: HudAccent;
  onClick: () => void;
}) {
  return (
    <IconButton
      label={label}
      // The accent is worn at REST too, not only when open. Everything in the rail used to fall back
      // to cyan until it was selected, so the one distinction that matters — a view REPLACES the page,
      // a tool opens BESIDE it — was visible only for the single entry you had already chosen. The
      // colours said nothing at exactly the moment you were deciding where to go.
      //
      // Views keep cyan at rest and go green when you are in one: green is "you are here", and that
      // has to stay a change of state rather than a permanent label. Tools are purple throughout,
      // because being a tool is not a state.
      accent={accent}
      active={active}
      onClick={onClick}
      aria-current={current}
      aria-pressed={pressed}
      className="h-9 w-9"
    >
      <Icon size={18} strokeWidth={2} />
    </IconButton>
  );
}
