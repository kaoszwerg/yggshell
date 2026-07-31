/**
 * Every message the interface shows, in English.
 *
 * **This file is the source.** A message is written here, edited here, and every other catalogue is
 * typed against it — so adding one and forgetting to translate it does not compile (`de.ts`).
 *
 * **Keys are `area.thing.part`**, flat rather than nested: a flat map is what makes "does every
 * language have every key" a one-line check instead of a tree walk, and it keeps a key greppable —
 * you can search the codebase for `settings.font.label` and find both its use and its wording.
 *
 * **What is NOT here.** Proper nouns (YggShell, tmux, Git, branch names), code samples, shell paths
 * and anything the user typed. Translating those would be wrong, not incomplete.
 */
export const en = {
  // ── Shared vocabulary ────────────────────────────────────────────────────────────────────────
  "common.close": "Close",
  "common.dismiss": "Dismiss",
  "common.back": "Back",
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.search": "search…",
  "common.default": "Default",
  "common.systemDefault": "System default",
  "common.on": "On",
  "common.off": "Off",
  // The build channel's name, not a word: it is "dev" in every language, the way a version number is.
  // In the catalogue anyway, so the decision that it does NOT get translated is visible rather than
  // an English string that happened to escape the check.
  "common.devChannel": "· dev",

  // ── Window chrome ────────────────────────────────────────────────────────────────────────────
  "titlebar.newTerminal": "New terminal",
  "titlebar.terminals": "Terminals",
  "titlebar.minimize": "Minimize",
  "titlebar.maximize": "Maximize",
  "titlebar.close": "Close",

  "nav.primary": "Primary",
  "nav.terminal": "Terminal",
  "nav.git": "Git",
  "nav.logs": "Logs",
  "nav.settings": "Settings",
  "nav.panelWidth": "{tool} panel width",

  "statusbar.scrollTop": "Scroll to top",
  // The button's own text, kept to one short word: a HUD button is a fixed clip-path shape, so a long
  // label is not wrapped but CROPPED. "Scroll to top" is the tooltip; this is what fits in the strip.
  "statusbar.top": "top",
  "statusbar.about": "About {app}",
  "statusbar.detached": "detached",
  "statusbar.toPush": "{count} to push",
  "statusbar.toPull": "{count} to pull",
  "statusbar.changed": "{count} changed",
  "statusbar.clean": "clean",
  "statusbar.running": "running",
  "statusbar.done": "done",
  "statusbar.failed": "failed",
  "statusbar.tmuxAttached": "Attached to the tmux session “{session}”",

  // ── The status bar editor ────────────────────────────────────────────────────────────────────
  "statusbar.item.version": "Version",
  "statusbar.item.version.hint": "The version and build channel. Opens About when clicked.",
  "statusbar.item.repository": "Repository",
  "statusbar.item.repository.hint":
    "Branch, ahead/behind and how many files have changed, for the tab in front.",
  "statusbar.item.command": "Running command",
  "statusbar.item.command.hint": "What the active terminal is running, and for how long.",
  "statusbar.item.cwd": "Directory",
  "statusbar.item.cwd.hint": "Where the active terminal is.",
  "statusbar.item.tmux": "tmux session",
  "statusbar.item.tmux.hint": "The tmux session the active tab is attached to, if any.",
  "statusbar.item.spacer": "Spacer",
  "statusbar.item.spacer.hint":
    "Flexible gap. Everything after it is pushed along — this is what does the aligning.",
  "statusbar.item.separator": "Separator",
  "statusbar.item.separator.hint": "A thin dividing line.",

  "statusbar.editor.available": "Available",
  // The group's accessible name, which is not the heading: "Available" alone tells a screen-reader
  // user nothing about what is available.
  "statusbar.editor.availableItems": "Available items",
  "statusbar.editor.add": "Add {item}",
  "statusbar.editor.allPlaced": "Everything is in the bar.",
  "statusbar.editor.paletteHint":
    "Drag one into the bar, or click to add it at the end. A spacer is what does the aligning — everything after it is pushed along, so two spacers around an item centre it.",
  "statusbar.editor.yourBar": "Your status bar",
  "statusbar.editor.empty": "The bar is empty — only the scroll-to-top control will show.",
  "statusbar.editor.itemHint": "{hint} — arrow keys move it, Backspace removes it.",
  "statusbar.editor.barHint":
    "Drag to reorder. With the keyboard: ← → move the focused item, Backspace removes it. The scroll-to-top control is not in this list: it comes and goes with what is on screen, and it is the only way back to the top of a long view.",
  "statusbar.editor.preview": "Preview",
  "statusbar.editor.previewHint":
    "An item with nothing to say shows nothing at all — no branch outside a repository, no session outside tmux. That is why the preview can look emptier than the list.",
  "statusbar.editor.reset": "Reset to defaults",
  "statusbar.editor.removeAll": "Remove all",

  // ── Settings ─────────────────────────────────────────────────────────────────────────────────
  "settings.sections": "Settings sections",
  "settings.tab.appearance": "Appearance",
  "settings.tab.terminal": "Terminal",
  "settings.tab.tools": "Tools",
  "settings.tab.window": "Window",
  "settings.tab.about": "About",

  "settings.interface.title": "Interface",
  "settings.interface.description": "How large the chrome is drawn — rail, tabs, panels.",
  "settings.interface.info":
    "The UI scale sizes the chrome — rail, tabs, panels. Terminal text has its own size, under Terminal, so the two can be set independently.",
  "settings.interface.scale": "UI scale",

  "settings.language.title": "Language",
  "settings.language.description": "What language the interface is in.",
  "settings.language.hint":
    "Applies immediately, everywhere. Only the interface changes — what your shell, your programs and your repositories say is theirs to decide.",

  "settings.statusbar.title": "Status bar",
  "settings.statusbar.description": "What the strip along the bottom shows, and in what order.",
  "settings.statusbar.info":
    "A flat list with flexible spacers rather than left/centre/right regions: a spacer pushes everything after it along, so two of them around an item centre it, and “second from the right” is something you can actually arrange.",

  "settings.shell.title": "Shell",
  "settings.shell.description": "What a new terminal starts.",
  "settings.shell.reading": "Reading what this machine offers…",
  "settings.shell.failed":
    "Could not read the available shells. New terminals still start your default shell.",
  "settings.shell.usingDefault": "Your account’s own shell",
  "settings.shell.takesEffect": "Takes effect for terminals opened from now on.",
  "settings.shell.keepsRunning":
    "Takes effect for terminals opened from now on; the ones already running keep the shell they started with.",

  "settings.font.title": "Font",
  "settings.font.description": "The typeface and size the terminal renders in.",
  "settings.font.info":
    "Terminal text size is independent of the UI scale: the emulator is handed a size divided by the WebView zoom, so changing one never drags the other along.",
  "settings.font.label": "Font",
  "settings.font.select": "Terminal font",
  "settings.font.notFound": "Not found on this machine — it will be used anyway if you have it.",
  "settings.font.preview": "Font preview",
  "settings.font.hint":
    "{font} ships with the app and is what a terminal uses when you have not chosen anything — it is the font powerlevel10k recommends, so a Powerline prompt works without installing anything. A font this list does not show can still be typed in: a WebView cannot enumerate what is installed, so the list is what could be detected rather than everything you have.",
  "settings.font.size": "Text size",
  "settings.font.sizeHint":
    "How much output fits on screen. The UI scale under Appearance sizes the chrome around it.",

  "settings.theme.title": "Theme",
  "settings.theme.description": "The colours a terminal, a diff and a commit are drawn in.",

  "settings.selection.title": "Selection",
  "settings.selection.description": "What happens when you drag across output.",
  "settings.selection.label": "Selecting text",
  "settings.selection.selectOnly": "Select only",
  "settings.selection.copy": "Copy to clipboard",
  "settings.selection.hint":
    "Off by default because it replaces whatever you had copied, without saying so. A middle-click always pastes the last selection either way, as on X11.",

  "settings.tmux.title": "tmux",
  "settings.tmux.description": "Whether a terminal joins a multiplexer session, and which one.",
  "settings.tmux.mode.off": "Off",
  "settings.tmux.mode.off.hint": "Start the shell directly.",
  "settings.tmux.mode.attach": "Attach if running",
  "settings.tmux.mode.attach.hint":
    "Join an existing session; start a plain shell when there is none.",
  "settings.tmux.mode.attachOrCreate": "Attach or create",
  "settings.tmux.mode.attachOrCreate.hint":
    "Always end up in a session, creating it the first time.",
  "settings.tmux.neverKilled":
    "Closing a tab or the app detaches — a session is never killed from here.",
  "settings.tmux.sessionName": "Session name",
  "settings.tmux.anyRunning": "any running session",
  "settings.tmux.sessionHint":
    "Left empty, “attach” joins whatever is running and “attach or create” uses yggshell. A name cannot contain : or . — tmux reads those as a window or pane.",

  "settings.profiles.title": "Profiles",
  "settings.profiles.description":
    "Saved combinations of shell and colour scheme, opened from the tab strip’s right-click menu.",

  "settings.git.title": "Git",
  "settings.git.description": "What the Git tool is allowed to do while it is open.",
  "settings.git.remote": "Git remote",
  "settings.git.check": "Check the remote",
  "settings.git.offline": "Stay offline",
  "settings.git.hint":
    "The ahead/behind counts come from what was last fetched, so without this they go quietly wrong — not unknown, but ↓0 while the remote has moved on. This is the only outbound connection the app makes: a git fetch every five minutes while something is showing those counts, never interactive, and it cannot touch your working tree.",

  "settings.window.closeButton": "Close button",
  "settings.window.closeDescription": "What the window’s close button does.",
  "settings.window.quit": "Quit app",
  "settings.window.tray": "Minimize to tray",
  "settings.window.trayHint":
    "“Minimize to tray” keeps the app running in the system tray with an Open/Quit menu.",

  // ── The command-line launcher ────────────────────────────────────────────────────────────────
  "cli.title": "Command line",
  "cli.description": "Open a terminal here from any shell, or from Finder.",
  "cli.install": "Install ygg command",
  "cli.reinstall": "Reinstall",
  "cli.checking": "Checking…",
  "cli.alreadyInstalled": "Installed in {directory} — {names}",
  "cli.notInstalled": "Not installed yet.",
  "cli.installing": "Installing…",
  "cli.installed": "Installed in {directory} — {names}",
  "cli.notOnPath":
    "{directory} is not on your PATH, so the shell will not find it yet. Add it to your shell profile, then open a new terminal.",
  "cli.failed": "Could not install the launcher: {reason}",
  "cli.usage":
    "ygg opens a terminal in the current directory; ygg <path> opens one there. Finder offers YggShell under Open With for any folder — that needs no installation.",

  // ── About ────────────────────────────────────────────────────────────────────────────────────
  "about.title": "About",
  "about.close": "Close About",

  // ── Terminal ─────────────────────────────────────────────────────────────────────────────────
  "terminal.newTab": "New terminal",
  "terminal.closeTab": "Close terminal",
  "terminal.search": "Find in terminal",
  "terminal.searchNext": "Next match",
  "terminal.searchPrevious": "Previous match",
  "terminal.colourScheme": "Colour scheme",
  "terminal.detach": "Detach from tmux",
  "terminal.starting": "Starting the shell…",
  "terminal.failed": "The terminal could not be started.",
  "terminal.retry": "Try again",
  "terminal.none": "No terminal open.",
  "terminal.actions": "Terminal actions",
  "terminal.copy": "Copy",
  "terminal.paste": "Paste",
  "terminal.find": "Search…",
  "terminal.schemeMenu": "Colour scheme…",
  "terminal.schemeFor": "Colour scheme for this terminal",
  "terminal.searchThe": "Search the terminal",
  "terminal.findPlaceholder": "Find…",
  "terminal.closeSearch": "Close search",

  // ── Git tool ─────────────────────────────────────────────────────────────────────────────────
  "git.reading": "Reading the repository…",
  "git.notARepository": "Not a git repository.",
  "git.branch": "BRANCH",
  "git.history": "HISTORY",
  "git.changedFiles": "Changed files",
  "git.commitHistory": "Commit history",
  "git.changesAndHistory": "Changes and history",
  "git.clean": "Working tree clean.",
  "git.noCommits": "No commits yet.",
  "git.staleCounts": "The counts may be out of date",
  "git.detail": "Git detail",
  "git.backToCommit": "Back to the commit",
  "git.readingDiff": "Reading the diff…",
  "git.readingCommit": "Reading the commit…",
  "git.commitMissing": "That commit is not in this repository.",
  "git.sideBySide": "Show side by side",
  "git.oneColumn": "Show as one column",

  // ── Logs ─────────────────────────────────────────────────────────────────────────────────────
  "logs.search": "Search logs",
  "logs.sort": "Toggle sort order",
  "logs.records": "{count} records",
  "logs.failed": "Failed to load logs: {message}",
  "logs.empty": "No log records.",
  "logs.level.all": "ALL",

  // ── Crashes ──────────────────────────────────────────────────────────────────────────────────
  "crash.lastSession": "The last session ended in a crash.",
  "crash.fatal": "FATAL ERROR",

  // ── Profiles ────────────────────────────────────────────────────────────────────────────────
  "profiles.none": "None yet.",
  "profiles.hint":
    "A tab keeps the profile it was opened with — it decided which shell is running, so changing it under a live tab would be a claim about a process that is not true.",
  "profiles.new": "New profile",
  "profiles.name": "Profile name",
  "profiles.scheme": "Colour scheme",
  "profiles.startIn": "Start in",
  "profiles.startInPlaceholder": "the shell’s own default",
  "profiles.startInHint":
    "An absolute path. It is validated when a terminal opens — a directory that has since been removed falls back to your home directory rather than failing to start.",

  // ── Colour schemes ──────────────────────────────────────────────────────────────────────────
  "scheme.terminal": "Terminal colour scheme",
  "scheme.label": "Colour scheme",
  "scheme.appliesToAll":
    "Applies to every open terminal at once — the emulator is repainted live, so nothing has to be restarted.",
  "scheme.new": "New scheme",
  "scheme.edit": "Edit “{name}”",
  "scheme.name": "Scheme name",
  "scheme.delete": "Delete this scheme",
  "scheme.named": "Named colours",
  "scheme.namedHint":
    "Left empty, a colour keeps the HUD’s — which is what an imported scheme that does not define it means.",
  "scheme.ansi": "ANSI palette",
  "scheme.thisTerminal": "THIS TERMINAL",
  "scheme.followSettings": "Follow the settings",
  "scheme.selectedText": "selected text",

  // ── Diffs and files ─────────────────────────────────────────────────────────────────────────
  "diff.fileGone": "That file is no longer in the repository.",
  "diff.binary": "Binary file — there is nothing to show line by line.",
  "diff.noChanges": "No changes in this file.",
  "diff.noChangesStaged": "No changes in this file between HEAD and the index.",

  // ── The Git tool without a directory ────────────────────────────────────────────────────────
  "git.waitingForCwd": "Waiting for the terminal to report where it is.",
  "git.noOsc7": "A shell that does not send OSC 7 never will — see the shell integration.",

  // ── Build identity ──────────────────────────────────────────────────────────────────────────
  "build.commitDate": "commit date",

  // ── Crashes, continued ──────────────────────────────────────────────────────────────────────
  "crash.reportSavedTo": "A report was saved to",
  "crash.staysOnDevice": ". It stays on this device.",
  "crash.fatalExplain":
    "The interface hit an error it could not recover from and has stopped drawing.",
  "crash.reportWritten": "A crash report was written to",
  "crash.sendItAlong": ". It stays on this device — send it along if you report this.",
  "crash.reportFailed": "The crash report could not be written. The failure is still in the log.",
  "crash.restart": "Restart interface",

  // ── Primitives ───────────────────────────────────────────────────────────────────────────────
  "ui.nothingMatches": "Nothing matches.",
  "ui.whatIsThis": "What is this?",
  "ui.newTab": "New tab",
} as const;
