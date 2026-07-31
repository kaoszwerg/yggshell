import { GitBranch, ScrollText, Settings, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { useUiStore, type ToolId, type ViewId } from "../../store/ui";

type NavItem = { id: ViewId; Icon: LucideIcon; label: string };
type ToolItem = { id: ToolId; Icon: LucideIcon; label: string };

const MAIN_NAV: NavItem[] = [{ id: "terminal", Icon: TerminalSquare, label: "Terminal" }];

/** Tools open the column beside this rail. They never replace what is on screen — that is what a view
 *  does, and the difference is the reason the column exists. */
const TOOLS: ToolItem[] = [{ id: "git", Icon: GitBranch, label: "Git" }];

const BOTTOM_NAV: NavItem[] = [
  { id: "logs", Icon: ScrollText, label: "Logs" },
  { id: "settings", Icon: Settings, label: "Settings" },
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

  return (
    <nav
      className="hud-strip flex w-14 shrink-0 flex-col items-center gap-1.5 py-2"
      style={{
        borderRight: "1px solid rgb(var(--saga-neon-cyan-rgb) / 0.3)",
        borderBottom: "none",
      }}
      aria-label="Primary"
    >
      {MAIN_NAV.map((item) => (
        <RailButton
          key={item.id}
          Icon={item.Icon}
          label={item.label}
          active={view === item.id}
          current={view === item.id ? "page" : undefined}
          onClick={() => setView(item.id)}
        />
      ))}

      <span aria-hidden className="bg-cyan/20 my-1 h-px w-7 shrink-0" />

      {TOOLS.map((tool) => (
        <RailButton
          key={tool.id}
          Icon={tool.Icon}
          label={tool.label}
          active={activeTool === tool.id}
          // `page` would be a lie: a tool does not replace the page, it opens beside it. `pressed`
          // is what a toggle says, and this button is a toggle.
          pressed={activeTool === tool.id}
          onClick={() => toggleTool(tool.id)}
        />
      ))}

      <div className="flex-1" />

      {BOTTOM_NAV.map((item) => (
        <RailButton
          key={item.id}
          Icon={item.Icon}
          label={item.label}
          active={view === item.id}
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
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  current?: "page";
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      label={label}
      accent={active ? "green" : "cyan"}
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
