/**
 * Every message the interface shows, in German.
 *
 * Typed against `en`, so this file cannot be incomplete: a message added to the source and not
 * translated here is a compile error, not something a German-speaking user finds later.
 *
 * **What stays English.** Technical terms and code identifiers keep their original form — `tmux`,
 * `Git`, `Branch`, `Commit`, `Diff`, `Shell`, `Powerline`, `WebView`. Translating them would make
 * the interface harder to use for exactly the people it is for, who read those words in their tools
 * all day. Everything that is a *sentence* is German.
 */
import type { Translations } from "./index";

export const de: Translations = {
  // ── Shared vocabulary ────────────────────────────────────────────────────────────────────────
  "common.close": "Schließen",
  "common.dismiss": "Ausblenden",
  "common.back": "Zurück",
  "common.refresh": "Aktualisieren",
  "common.loading": "Wird geladen…",
  "common.search": "suchen…",
  "common.default": "Standard",
  "common.systemDefault": "Systemstandard",
  "common.on": "An",
  "common.off": "Aus",
  "common.devChannel": "· dev",

  // ── Window chrome ────────────────────────────────────────────────────────────────────────────
  "titlebar.newTerminal": "Neues Terminal",
  "titlebar.terminals": "Terminals",
  "titlebar.scrollLeft": "Frühere Tabs zeigen",
  "titlebar.scrollRight": "Spätere Tabs zeigen",
  "titlebar.minimize": "Minimieren",
  "titlebar.maximize": "Maximieren",
  "titlebar.close": "Schließen",

  "nav.primary": "Hauptnavigation",
  "nav.terminal": "Terminal",
  "nav.git": "Git",
  "nav.files": "Dateien",
  "files.waitingForCwd": "Es wird darauf gewartet, dass das Terminal meldet, wo es steht.",
  "files.reading": "Wird gelesen…",
  "files.empty": "Dieser Ordner ist leer.",
  "files.allHidden": "Hier ist alles versteckt.",
  "files.truncated": "Zu viele Einträge, um alle zu zeigen.",
  "files.showHidden": "Versteckte Einträge zeigen",
  "files.hideHidden": "Versteckte Einträge ausblenden",
  "files.reveal": "Im Dateimanager zeigen",
  "files.actions": "Aktionen für {name}",
  "files.copyPath": "Pfad kopieren",
  "nav.logs": "Protokoll",
  "nav.settings": "Einstellungen",
  "nav.panelWidth": "Breite des {tool}-Bereichs",

  "statusbar.scrollTop": "Nach oben springen",
  "statusbar.top": "oben",
  "statusbar.about": "Über {app}",
  "statusbar.detached": "losgelöst",
  "statusbar.toPush": "{count} zu pushen",
  "statusbar.toPull": "{count} zu pullen",
  "statusbar.changed": "{count} geändert",
  "statusbar.clean": "sauber",
  "statusbar.running": "läuft",
  "statusbar.done": "fertig",
  "statusbar.failed": "fehlgeschlagen",
  "statusbar.load":
    "Last {value} bei {cores} Kernen — {one}, {five}, {fifteen} über 1, 5 und 15 Minuten",
  "statusbar.tmuxAttached": "Verbunden mit der tmux-Session „{session}“",

  // ── The status bar editor ────────────────────────────────────────────────────────────────────
  "statusbar.item.version": "Version",
  "statusbar.item.version.hint": "Version und Build-Kanal. Ein Klick öffnet den Über-Dialog.",
  "statusbar.item.repository": "Repository",
  "statusbar.item.repository.hint":
    "Branch, ahead/behind und wie viele Dateien geändert sind — für den vordersten Tab.",
  "statusbar.item.command": "Laufender Befehl",
  "statusbar.item.command.hint": "Was im aktiven Terminal läuft, und wie lange schon.",
  "statusbar.item.cwd": "Verzeichnis",
  "statusbar.item.cwd.hint": "Wo das aktive Terminal gerade steht.",
  "statusbar.item.tmux": "tmux-Session",
  "statusbar.item.tmux.hint": "Die tmux-Session des aktiven Tabs, sofern er in einer ist.",
  "statusbar.item.load": "Systemlast",
  "statusbar.item.load.hint":
    "Wie ausgelastet der Rechner ist — die Last im Mittel über eine Minute, im Verhältnis zur Zahl der Kerne.",
  "statusbar.item.spacer": "Abstandhalter",
  "statusbar.item.spacer.hint":
    "Dehnbare Lücke. Alles dahinter wird nach hinten geschoben — das ist es, was ausrichtet.",
  "statusbar.item.separator": "Trennlinie",
  "statusbar.item.separator.hint": "Eine dünne Trennlinie.",

  "statusbar.editor.available": "Verfügbar",
  "statusbar.editor.availableItems": "Verfügbare Elemente",
  "statusbar.editor.add": "{item} hinzufügen",
  "statusbar.editor.allPlaced": "Alles ist bereits in der Leiste.",
  "statusbar.editor.paletteHint":
    "Zieh eines in die Leiste oder klick darauf, um es hinten anzuhängen. Ein Abstandhalter ist das, was ausrichtet — alles dahinter wird nach hinten geschoben, zwei davon um ein Element herum zentrieren es.",
  "statusbar.editor.yourBar": "Deine Statusleiste",
  "statusbar.editor.empty":
    "Die Leiste ist leer — nur die Schaltfläche „nach oben“ wird noch erscheinen.",
  "statusbar.editor.itemHint": "{hint} — Pfeiltasten verschieben, Rücktaste entfernt.",
  "statusbar.editor.barHint":
    "Zum Umsortieren ziehen. Mit der Tastatur: ← → verschieben das fokussierte Element, die Rücktaste entfernt es. Die Schaltfläche „nach oben“ steht nicht in dieser Liste: sie erscheint und verschwindet je nach Inhalt, und sie ist der einzige Weg zurück an den Anfang einer langen Ansicht.",
  "statusbar.editor.preview": "Vorschau",
  "statusbar.editor.previewHint":
    "Ein Element ohne Inhalt zeigt gar nichts — kein Branch außerhalb eines Repositories, keine Session außerhalb von tmux. Deshalb kann die Vorschau leerer wirken als die Liste.",
  "statusbar.editor.reset": "Auf Standard zurücksetzen",
  "statusbar.editor.removeAll": "Alle entfernen",

  // ── Settings ─────────────────────────────────────────────────────────────────────────────────
  "settings.sections": "Bereiche der Einstellungen",
  "settings.tab.appearance": "Darstellung",
  "settings.tab.terminal": "Terminal",
  "settings.tab.tools": "Werkzeuge",
  "settings.tab.window": "Fenster",
  "settings.tab.about": "Über",

  "settings.interface.title": "Oberfläche",
  "settings.interface.description": "Wie groß der Rahmen gezeichnet wird — Leiste, Tabs, Panels.",
  "settings.interface.info":
    "Die Skalierung betrifft den Rahmen — Leiste, Tabs, Panels. Der Terminaltext hat unter „Terminal“ seine eigene Größe, damit sich beides unabhängig einstellen lässt.",
  "settings.interface.scale": "Skalierung",

  "settings.language.title": "Sprache",
  "settings.language.description": "In welcher Sprache die Oberfläche erscheint.",
  "settings.language.hint":
    "Wirkt sofort und überall. Nur die Oberfläche ändert sich — was deine Shell, deine Programme und deine Repositories ausgeben, entscheiden sie selbst.",

  "settings.statusbar.title": "Statusleiste",
  "settings.statusbar.description":
    "Was die Leiste am unteren Rand zeigt, und in welcher Reihenfolge.",
  "settings.statusbar.info":
    "Eine flache Liste mit dehnbaren Abstandhaltern statt fester Bereiche links/mitte/rechts: ein Abstandhalter schiebt alles dahinter nach hinten, zwei davon zentrieren ein Element, und „das zweite von rechts“ lässt sich damit überhaupt erst einrichten.",

  "settings.shell.title": "Shell",
  "settings.shell.description": "Womit ein neues Terminal startet.",
  "settings.shell.reading": "Es wird gelesen, was dieser Rechner anbietet…",
  "settings.shell.failed":
    "Die verfügbaren Shells konnten nicht gelesen werden. Neue Terminals starten weiterhin deine Standard-Shell.",
  "settings.shell.usingDefault": "Die Shell deines Benutzerkontos",
  "settings.shell.takesEffect": "Gilt für Terminals, die ab jetzt geöffnet werden.",
  "settings.shell.keepsRunning":
    "Gilt für Terminals, die ab jetzt geöffnet werden; die bereits laufenden behalten ihre Shell.",

  "settings.font.title": "Schriftart",
  "settings.font.description": "Schnitt und Größe, in denen das Terminal zeichnet.",
  "settings.font.info":
    "Die Textgröße des Terminals ist unabhängig von der Skalierung: der Emulator bekommt eine durch den WebView-Zoom geteilte Größe, damit das eine nie das andere mitzieht.",
  "settings.font.label": "Schriftart",
  "settings.font.select": "Terminal-Schriftart",
  "settings.font.notFound":
    "Auf diesem Rechner nicht gefunden — sie wird trotzdem verwendet, falls du sie hast.",
  "settings.font.preview": "Schriftvorschau",
  "settings.font.hint":
    "{font} wird mitgeliefert und ist das, was ein Terminal verwendet, solange du nichts auswählst — es ist die von powerlevel10k empfohlene Schrift, ein Powerline-Prompt funktioniert also ohne Installation. Eine Schrift, die hier nicht auftaucht, kannst du trotzdem eintippen: ein WebView kann nicht aufzählen, was installiert ist, die Liste ist also das Erkennbare und nicht alles, was du hast.",
  "settings.font.size": "Textgröße",
  "settings.font.sizeHint":
    "Wie viel Ausgabe auf den Bildschirm passt. Die Skalierung unter „Darstellung“ bestimmt den Rahmen darum herum.",

  "settings.theme.title": "Farbschema",
  "settings.theme.description": "Die Farben, in denen Terminal, Diff und Commit gezeichnet werden.",

  "settings.selection.title": "Auswahl",
  "settings.selection.description": "Was passiert, wenn du über die Ausgabe ziehst.",
  "settings.selection.label": "Text auswählen",
  "settings.selection.selectOnly": "Nur auswählen",
  "settings.selection.copy": "In die Zwischenablage",
  "settings.selection.hint":
    "Standardmäßig aus, weil es kommentarlos ersetzt, was du zuletzt kopiert hattest. Ein Klick mit der mittleren Maustaste fügt die letzte Auswahl ohnehin immer ein, wie unter X11.",

  "settings.tmux.title": "tmux",
  "settings.tmux.description": "Ob ein Terminal einer Multiplexer-Session beitritt, und welcher.",
  "settings.tmux.mode.off": "Aus",
  "settings.tmux.mode.off.hint": "Die Shell direkt starten.",
  "settings.tmux.mode.attach": "Beitreten, falls vorhanden",
  "settings.tmux.mode.attach.hint":
    "Einer laufenden Session beitreten; ist keine da, startet eine gewöhnliche Shell.",
  "settings.tmux.mode.attachOrCreate": "Beitreten oder anlegen",
  "settings.tmux.mode.attachOrCreate.hint":
    "Immer in einer Session landen — beim ersten Mal wird sie angelegt.",
  "settings.tmux.neverKilled":
    "Einen Tab oder die App zu schließen löst nur die Verbindung — eine Session wird von hier aus nie beendet.",
  "settings.tmux.sessionName": "Name der Session",
  "settings.tmux.anyRunning": "irgendeine laufende Session",
  "settings.tmux.sessionHint":
    "Bleibt das Feld leer, tritt „beitreten“ irgendeiner laufenden Session bei und „beitreten oder anlegen“ verwendet yggshell. Ein Name darf kein : oder . enthalten — tmux liest das als Fenster oder Pane.",

  "settings.profiles.title": "Profile",
  "settings.profiles.description":
    "Gespeicherte Kombinationen aus Shell und Farbschema, aufrufbar über das Kontextmenü der Tab-Leiste.",

  "settings.git.title": "Git",
  "settings.git.description": "Was das Git-Werkzeug tun darf, solange es geöffnet ist.",
  "settings.git.remote": "Git-Remote",
  "settings.git.check": "Remote abfragen",
  "settings.git.offline": "Offline bleiben",
  "settings.git.hint":
    "Die ahead/behind-Zahlen stammen aus dem, was zuletzt geholt wurde — ohne das werden sie still und leise falsch: nicht „unbekannt“, sondern ↓0, während sich der Remote längst weiterbewegt hat. Das ist die einzige ausgehende Verbindung der App: ein git fetch alle fünf Minuten, solange irgendetwas diese Zahlen anzeigt, nie interaktiv, und es rührt deinen Arbeitsbaum nicht an.",

  "settings.window.closeButton": "Schließen-Knopf",
  "settings.window.closeDescription": "Was der Schließen-Knopf des Fensters bewirkt.",
  "settings.window.quit": "App beenden",
  "settings.window.tray": "In die Menüleiste",
  "settings.window.trayHint":
    "„In die Menüleiste“ lässt die App im Hintergrund weiterlaufen, mit einem Menü zum Öffnen und Beenden.",

  // ── The command-line launcher ────────────────────────────────────────────────────────────────
  "cli.title": "Kommandozeile",
  "cli.description": "Von jeder Shell aus — oder aus dem Finder — hier ein Terminal öffnen.",
  "cli.install": "ygg-Befehl installieren",
  "cli.reinstall": "Neu installieren",
  "cli.checking": "Wird geprüft…",
  "cli.alreadyInstalled": "Installiert in {directory} — {names}",
  "cli.notInstalled": "Noch nicht installiert.",
  "cli.installing": "Wird installiert…",
  "cli.installed": "Installiert in {directory} — {names}",
  "cli.notOnPath":
    "{directory} liegt nicht in deinem PATH, die Shell findet den Befehl also noch nicht. Nimm das Verzeichnis in dein Shell-Profil auf und öffne ein neues Terminal.",
  "cli.failed": "Der Befehl konnte nicht installiert werden: {reason}",
  "cli.usage":
    "ygg öffnet ein Terminal im aktuellen Verzeichnis, ygg <Pfad> eines dort. Der Finder bietet YggShell für jeden Ordner unter „Öffnen mit“ an — dafür ist keine Installation nötig.",

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────────────────────
  "keys.title": "Tastatur",
  "keys.description": "Was jedes Kürzel bewirkt und mit welchen Tasten man es aufruft.",
  "keys.info":
    "Ein Kürzel muss den Zusatz tragen, den das Terminal selbst nie erhält — auf dieser Plattform {modifier}. Alles andere ginge an die Shell, und einem Programm Ctrl+C wegzunehmen darf keine Einstellung können.",
  "keys.change": "Ändern",
  "keys.recording": "Taste drücken…",
  "keys.cancel": "Abbrechen",
  "keys.reset": "Alle Kürzel zurücksetzen",
  "keys.reserved": "Diese Kombination gehört der Shell. Nimm {modifier}.",
  "keys.conflict": "Bereits belegt durch „{action}“.",
  "keys.action.newTab": "Neues Terminal",
  "keys.action.closeTab": "Terminal schließen",
  "keys.action.nextTab": "Nächster Tab",
  "keys.action.previousTab": "Vorheriger Tab",
  "keys.action.selectTab1": "Zu Tab 1",
  "keys.action.selectTab2": "Zu Tab 2",
  "keys.action.selectTab3": "Zu Tab 3",
  "keys.action.selectTab4": "Zu Tab 4",
  "keys.action.selectTab5": "Zu Tab 5",
  "keys.action.selectTab6": "Zu Tab 6",
  "keys.action.selectTab7": "Zu Tab 7",
  "keys.action.selectTab8": "Zu Tab 8",
  "keys.action.selectTab9": "Zu Tab 9",
  "keys.action.find": "Im Terminal suchen",
  "keys.action.fontBigger": "Größere Schrift",
  "keys.action.fontSmaller": "Kleinere Schrift",
  "keys.action.fontReset": "Standard-Schriftgröße",
  "keys.action.clear": "Bildschirm leeren",
  "keys.action.openSettings": "Einstellungen öffnen",
  "keys.action.openLogs": "Protokoll öffnen",
  "keys.action.toggleGitTool": "Git-Werkzeug ein- oder ausblenden",

  // ── Things the mouse does ───────────────────────────────────────────────────────────────────
  "keys.mouse.title": "Maus",
  "keys.mouse.openLink": "Link im Browser öffnen",
  "keys.mouse.openLink.how": "{modifier}-Klick",
  "keys.mouse.paste": "Letzte Auswahl einfügen",
  "keys.mouse.paste.how": "Mittelklick",
  "keys.mouse.menu": "Kopieren, Einfügen, Suchen, Farbschema",
  "keys.mouse.menu.how": "Rechtsklick",

  // ── About ────────────────────────────────────────────────────────────────────────────────────
  "about.title": "Über",
  "about.close": "Über-Dialog schließen",
  "about.changelog": "Neuerungen",
  "about.changelogDescription": "Alle Änderungen, neueste zuerst.",
  "about.changelogFailed": "Das Änderungsprotokoll konnte nicht gelesen werden: {reason}",
  "about.credits": "Lizenzen",
  "about.creditsDescription": "Die mitgelieferten Farbschemata und woher sie stammen.",
  "about.creditsFailed": "Die Lizenzhinweise konnten nicht gelesen werden: {reason}",

  // ── Terminal ─────────────────────────────────────────────────────────────────────────────────
  "terminal.newTab": "Neues Terminal",
  "terminal.closeTab": "Terminal schließen",
  "terminal.search": "Im Terminal suchen",
  "terminal.searchNext": "Nächster Treffer",
  "terminal.searchPrevious": "Vorheriger Treffer",
  "terminal.colourScheme": "Farbschema",
  "terminal.detach": "Von tmux lösen",
  "terminal.starting": "Die Shell wird gestartet…",
  "terminal.failed": "Das Terminal konnte nicht gestartet werden.",
  "terminal.retry": "Erneut versuchen",
  "terminal.none": "Kein Terminal geöffnet.",
  "terminal.actions": "Terminal-Aktionen",
  "terminal.copy": "Kopieren",
  "terminal.paste": "Einfügen",
  "terminal.find": "Suchen…",
  "terminal.schemeMenu": "Farbschema…",
  "terminal.schemeFor": "Farbschema für dieses Terminal",
  "terminal.searchThe": "Im Terminal suchen",
  "terminal.findPlaceholder": "Finden…",
  "terminal.closeSearch": "Suche schließen",

  // ── Git tool ─────────────────────────────────────────────────────────────────────────────────
  "git.reading": "Das Repository wird gelesen…",
  "git.notARepository": "Kein Git-Repository.",
  "git.branch": "BRANCH",
  "git.history": "VERLAUF",
  "git.changedFiles": "Geänderte Dateien",
  "git.commitHistory": "Commit-Verlauf",
  "git.changesAndHistory": "Änderungen und Verlauf",
  "git.clean": "Arbeitsbaum ist sauber.",
  "git.noCommits": "Noch keine Commits.",
  "git.staleCounts": "Die Zahlen sind möglicherweise nicht mehr aktuell",
  "git.detail": "Git-Detailansicht",
  "git.backToCommit": "Zurück zum Commit",
  "git.readingDiff": "Das Diff wird gelesen…",
  "git.readingCommit": "Der Commit wird gelesen…",
  "git.commitMissing": "Dieser Commit liegt nicht in diesem Repository.",
  "git.sideBySide": "Nebeneinander anzeigen",
  "git.oneColumn": "In einer Spalte anzeigen",

  // ── Logs ─────────────────────────────────────────────────────────────────────────────────────
  "logs.search": "Protokoll durchsuchen",
  "logs.sort": "Sortierung umkehren",
  "logs.records": "{count} Einträge",
  "logs.failed": "Das Protokoll konnte nicht geladen werden: {message}",
  "logs.empty": "Keine Protokolleinträge.",
  "logs.level.all": "ALLE",

  // ── Crashes ──────────────────────────────────────────────────────────────────────────────────
  "crash.lastSession": "Die letzte Sitzung endete mit einem Absturz.",
  "crash.fatal": "SCHWERER FEHLER",

  // ── Profiles ────────────────────────────────────────────────────────────────────────────────
  "profiles.none": "Noch keine.",
  "profiles.hint":
    "Ein Tab behält das Profil, mit dem er geöffnet wurde — es hat entschieden, welche Shell läuft, eine Änderung unter einem laufenden Tab wäre also eine Behauptung über einen Prozess, die nicht stimmt.",
  "profiles.new": "Neues Profil",
  "profiles.name": "Profilname",
  "profiles.scheme": "Farbschema",
  "profiles.startIn": "Starten in",
  "profiles.startInPlaceholder": "im Standard der Shell",
  "profiles.startInHint":
    "Ein absoluter Pfad. Er wird beim Öffnen eines Terminals geprüft — ein inzwischen gelöschtes Verzeichnis führt zurück ins Benutzerverzeichnis, statt den Start scheitern zu lassen.",

  // ── Colour schemes ──────────────────────────────────────────────────────────────────────────
  "scheme.terminal": "Farbschema des Terminals",
  "scheme.label": "Farbschema",
  "scheme.appliesToAll":
    "Gilt sofort für alle offenen Terminals — der Emulator wird live neu gezeichnet, es muss nichts neu gestartet werden.",
  "scheme.inUse": "aktiv",
  "scheme.new": "Neues Schema",
  "scheme.edit": "„{name}“ bearbeiten",
  "scheme.name": "Name des Schemas",
  "scheme.delete": "Dieses Schema löschen",
  "scheme.named": "Benannte Farben",
  "scheme.namedHint":
    "Bleibt eine Farbe leer, behält sie die des HUD — genau das bedeutet ein importiertes Schema, das sie nicht festlegt.",
  "scheme.ansi": "ANSI-Palette",
  "scheme.thisTerminal": "DIESES TERMINAL",
  "scheme.followSettings": "Den Einstellungen folgen",
  "scheme.selectedText": "ausgewählter Text",

  // ── Diffs and files ─────────────────────────────────────────────────────────────────────────
  "diff.fileGone": "Diese Datei liegt nicht mehr im Repository.",
  "diff.binary": "Binärdatei — es gibt nichts, was sich Zeile für Zeile anzeigen ließe.",
  "diff.noChanges": "Keine Änderungen in dieser Datei.",
  "diff.noChangesStaged": "Keine Änderungen in dieser Datei zwischen HEAD und dem Index.",

  // ── The Git tool without a directory ────────────────────────────────────────────────────────
  "git.waitingForCwd": "Es wird darauf gewartet, dass das Terminal meldet, wo es steht.",
  "git.noOsc7": "Eine Shell, die kein OSC 7 sendet, wird es nie tun — siehe die Shell-Integration.",

  // ── Build identity ──────────────────────────────────────────────────────────────────────────
  "build.commitDate": "Commit-Datum",

  // ── Crashes, continued ──────────────────────────────────────────────────────────────────────
  "crash.reportSavedTo": "Ein Bericht wurde gespeichert unter",
  "crash.staysOnDevice": ". Er bleibt auf diesem Gerät.",
  "crash.fatalExplain":
    "Die Oberfläche ist auf einen Fehler gestoßen, von dem sie sich nicht erholen konnte, und zeichnet nicht mehr.",
  "crash.reportWritten": "Ein Absturzbericht wurde geschrieben nach",
  "crash.sendItAlong": ". Er bleibt auf diesem Gerät — schick ihn mit, wenn du das meldest.",
  "crash.reportFailed":
    "Der Absturzbericht konnte nicht geschrieben werden. Der Fehler steht trotzdem im Protokoll.",
  "crash.restart": "Oberfläche neu starten",

  // ── Primitives ───────────────────────────────────────────────────────────────────────────────
  "ui.nothingMatches": "Keine Treffer.",
  "ui.whatIsThis": "Was ist das?",
  "ui.newTab": "Neuer Tab",
};
