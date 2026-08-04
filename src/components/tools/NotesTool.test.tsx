import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotesTool } from "./NotesTool";
import { useUiStore } from "../../store/ui";
// The sync throttle is shared across the application on purpose (one repository, many callers), so
// it also outlives a test — a mount here syncs only if the previous test's mount did not just do it.
import { resetSyncThrottle } from "../../hooks/useNotesSync";

vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
vi.mock("../../hooks/useNoteProject", () => ({ useNoteProject: () => "github.com/a/b" }));
vi.mock("../../api/notes", () => ({
  notesApi: {
    topics: vi.fn(),
    read: vi.fn(),
    capture: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    removeProject: vi.fn(() => Promise.resolve()),
    projects: vi.fn(() => Promise.resolve(["github.com/a/b"])),
    // One call for the whole panel, instead of topics-then-read per file. The mock derives it from
    // the same `topics`/`read` fixtures, so a test only has to describe the notes once.
    tree: vi.fn(),
    index: vi.fn(() => Promise.resolve([])),
    status: vi.fn(() =>
      Promise.resolve({
        connected: false,
        remote: "",
        branch: "main",
        sync: false,
        path: "/tmp/notes",
        git_available: true,
        last_sync: null,
        last_error: null,
        ahead: 0,
        dirty: false,
      }),
    ),
    // Opening the tool syncs — that is the only place it happens, because doing it at startup put a
    // Touch ID prompt in front of the app.
    sync: vi.fn(() => Promise.resolve()),
    toggle: vi.fn(() => Promise.resolve(true)),
    search: vi.fn(() => Promise.resolve([])),
    // The backend opens the picker, so from here an import is "into this project" and nothing else.
    import: vi.fn(() => Promise.resolve({ picked: true, entries: [] })),
    importFolder: vi.fn(() => Promise.resolve({ picked: true, entries: [] })),
  },
}));

import { notesApi } from "../../api/notes";

/**
 * Point `tree` at the same fixtures a test already gave `topics` and `read`.
 *
 * The tool asks once for everything now; the tests still describe their notes file by file, which is
 * how a reader understands them.
 */
function treeFromFixtures(project = "github.com/a/b") {
  vi.mocked(notesApi.tree).mockImplementation(async (projects: string[]) => {
    const out = [];
    for (const each of projects.length > 0 ? projects : [project]) {
      for (const topic of await vi.mocked(notesApi.topics)(each)) {
        out.push({ project: each, topic, text: await vi.mocked(notesApi.read)(each, topic) });
      }
    }
    return out;
  });
}

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesTool />
    </QueryClientProvider>,
  );
}

describe("NotesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncThrottle();
    useUiStore.setState({ locale: "en", view: "terminal", note: null });
    vi.mocked(notesApi.topics).mockResolvedValue(["inbox", "release"]);
    vi.mocked(notesApi.read).mockImplementation((_p: string, topic: string) =>
      Promise.resolve(
        topic === "inbox"
          ? "- [ ] !! ask about the frame\n      it flickers after a resize\n- [x] shipped\n"
          : "- [ ] notarise\n",
      ),
    );
    treeFromFixtures();
  });

  it("shows one line per task and never its body", async () => {
    // The whole reason the tool and the view are separate surfaces. A body in a 280px column is what
    // stops the list being readable at a glance — "ich will auf einen Blick die aktuelle Situation
    // erfassen können".
    renderTool();

    expect(await screen.findByText("ask about the frame")).toBeTruthy();
    expect(screen.queryByText(/it flickers after a resize/)).toBeNull();
  });

  it("hides what is done until it is asked for, rather than deleting it", async () => {
    // A list that only grows becomes unreadable; a list that forgets is worse. The fold is the
    // answer the attention signal reached first (rule:attention-signals).
    renderTool();
    await screen.findByText("ask about the frame");

    expect(screen.queryByText("shipped")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /DONE · 1/i }));

    expect(await screen.findByText("shipped")).toBeTruthy();
  });

  it("files a capture with Enter and keeps typing on Shift+Enter", async () => {
    // The same keys the maintainer already types at the harness one panel over. A staging area that
    // costs two gestures is one people stop using.
    renderTool();
    const field = await screen.findByLabelText("Note something…");

    fireEvent.change(field, { target: { value: "a thought" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(notesApi.capture).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => {
      expect(notesApi.capture).toHaveBeenCalledWith("github.com/a/b", "a thought");
    });
  });

  it("ticks from the list, with no trip to the view", async () => {
    // Ticking is not editing: it rewrites the marker in the file, from here, with no mode. By far
    // the most frequent thing anyone does with this.
    renderTool();
    await screen.findByText("ask about the frame");

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as done" })[0] as HTMLElement);

    await waitFor(() => {
      expect(notesApi.toggle).toHaveBeenCalled();
    });
    // The offset is the parser's, not a guess — the backend rewrites three bytes at it.
    expect(vi.mocked(notesApi.toggle).mock.calls[0]?.[2]).toBe(0);
    // And it does NOT also open the note. The checkbox sits inside the row, whose job is to open —
    // so before `Row` learned to ignore a click that came out of one of its own controls, ticking
    // threw the user into the full view. The same bubble opened a stray terminal tab from the tmux
    // tool's end button; this is the second place it was live.
    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("searches across every project and opens the hit in the view", async () => {
    // Search IS navigation, which is why it lives in the tool rather than the page.
    vi.mocked(notesApi.search).mockResolvedValue([
      { project: "github.com/x/y", topic: "release", line: "notarise", offset: 42 },
    ]);
    renderTool();

    fireEvent.change(await screen.findByLabelText("Search all notes"), {
      target: { value: "notar" },
    });

    // It searches EVERY project, whichever one is selected — so a hit has to say where it is from.
    // Without the project, two hits called "notarise" in two repositories are the same row twice.
    expect(await screen.findByText("y · release")).toBeTruthy();

    fireEvent.click(await screen.findByText("notarise"));
    expect(useUiStore.getState().view).toBe("notes");
    expect(useUiStore.getState().note).toEqual({
      project: "github.com/x/y",
      topic: "release",
      // **The hit's own offset travels with it.** It used to be dropped here, deliberately, because
      // an offset meant "put me in the editor" — so carrying it would have answered a search by
      // opening a text field. Now `edit` says that separately, and a search that finds a line and
      // then opens the file at the top has done half its job.
      at: 42,
      edit: false,
    });
  });

  it("gets out of the search again, by a control and by Escape", async () => {
    // A search REPLACES the list, so it is a state you have to be able to leave — and emptying a
    // field by hand is not a way out anyone should have to find. "wie cleare ich die suche um
    // zurück zur hauptansicht zu kommen?"
    vi.mocked(notesApi.search).mockResolvedValue([
      { project: "github.com/x/y", topic: "release", line: "notarise", offset: 0 },
    ]);
    renderTool();
    const field = await screen.findByLabelText("Search all notes");

    fireEvent.change(field, { target: { value: "notar" } });
    expect(await screen.findByText("notarise")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(await screen.findByText("ask about the frame")).toBeTruthy();

    fireEvent.change(field, { target: { value: "notar" } });
    expect(await screen.findByText("notarise")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(await screen.findByText("ask about the frame")).toBeTruthy();
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size — a note list reads like a terminal, and the setting exists because the
    // maintainer's eyes are not the developer's.
    const { container } = renderTool();
    await screen.findByText("ask about the frame");

    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
});

describe("managing what is in the list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncThrottle();
    useUiStore.setState({ locale: "en", view: "terminal", note: null });
    vi.mocked(notesApi.topics).mockResolvedValue(["inbox"]);
    vi.mocked(notesApi.read).mockResolvedValue("- [ ] first\n- [ ] second\n");
    treeFromFixtures();
  });

  it("offers the actions on a VISIBLE control, not only on right-click", async () => {
    // The first build had them on right-click and the first question was "where is the menu?".
    // A hidden affordance is a missing one — nobody right-clicks a list row they have not seen.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Actions for first" }));

    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeTruthy();
    // Copy, NOT "type into the terminal": the notes hold prompts prepared to be sent later and todos
    // to be ticked, and typing a checklist item into a shell is senseless. Handing something over is
    // copying it and pasting it where it belongs — the maintainer's own description, and it reversed
    // what the plan had called the reason this tool exists.
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /terminal/i })).toBeNull();
  });

  it("shows git's own answer to 'is my work anywhere but here'", async () => {
    // "woran kann ich erkennen ob das speichern und syncen geklappt hat … sonst weiß ich ja nie ob
    // mein stand auch remote liegt" — and "git hat doch stati, warum zeigst du die nicht an?". It
    // does: commits ahead of origin, and edits not yet committed. A timestamp says when something
    // last worked, never whether THIS note made it.
    vi.mocked(notesApi.status).mockResolvedValue({
      connected: true,
      remote: "git@github.com:a/b.git",
      branch: "main",
      sync: true,
      path: "/tmp/notes",
      git_available: true,
      last_sync: null,
      last_error: null,
      ahead: 2,
      dirty: false,
    });
    renderTool();

    expect(await screen.findByText("2 not pushed")).toBeTruthy();
  });

  it("says 'in sync' only when nothing is outstanding", async () => {
    vi.mocked(notesApi.status).mockResolvedValue({
      connected: true,
      remote: "git@github.com:a/b.git",
      branch: "main",
      sync: true,
      path: "/tmp/notes",
      git_available: true,
      last_sync: 1_785_000_000n,
      last_error: null,
      ahead: 0,
      dirty: false,
    });
    renderTool();

    expect(await screen.findByText("In sync")).toBeTruthy();
  });

  it("calls the round arrow a SYNC, because that is what it does", async () => {
    // It invalidated three local queries and touched no remote — next to a badge claiming to know
    // whether the remote has your work, a button labelled "Refresh" that does not talk to it is a
    // trap. Pressing it syncs, then re-reads.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => {
      // Once on mount, once for the press — the second one is the point.
      expect(vi.mocked(notesApi.sync).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("says it out loud when the sync is failing", async () => {
    // It failed on every single attempt for days — "There is no tracking information for the current
    // branch" — and said so only in the log file. What the maintainer saw was notes that were not on
    // the other machine and a showcase note that never arrived, with the app looking perfectly
    // healthy. A background job that keeps failing in silence is the defect (rule:logging: logged
    // AND surfaced).
    vi.mocked(notesApi.sync).mockRejectedValue(new Error("no tracking information"));
    renderTool();

    expect(await screen.findByText(/no tracking information/)).toBeTruthy();
  });

  it("opens a file from its OWN name, whether or not anything in it is a task", async () => {
    // "wie zum geier soll ich an die eigentlichen dateien kommen wenn sie keine checkboxen enthalten
    // und deshalb keinen eintrag enthalten??" — the list was built out of checkbox items, so a note
    // holding prose, a code block or a prepared prompt had nothing to click. The file's name is the
    // way in, and it is there for every file: a note is a note, a task is one kind of line inside it.
    vi.mocked(notesApi.topics).mockResolvedValue(["inbox", "prompts"]);
    vi.mocked(notesApi.read).mockImplementation((_p: string, topic: string) =>
      Promise.resolve(topic === "inbox" ? "- [ ] first\n" : "Refactor the pty layer, keeping…\n"),
    );
    treeFromFixtures();
    renderTool();

    fireEvent.click(await screen.findByRole("button", { name: "Open prompts" }));

    expect(useUiStore.getState().view).toBe("notes");
    expect(useUiStore.getState().note).toEqual({
      project: "github.com/a/b",
      topic: "prompts",
      // A topic heading has no position in the file, so there is nothing to scroll to.
      at: null,
      edit: false,
    });
  });

  it("keeps the file's own menu working from that same name", async () => {
    // The `⋮` sits inside the heading, and the heading opens the file. Both, from one row, because
    // `Row` leaves a click that came out of a control to that control.
    vi.mocked(notesApi.topics).mockResolvedValue(["prompts"]);
    vi.mocked(notesApi.read).mockResolvedValue("just prose\n");
    treeFromFixtures();
    renderTool();

    fireEvent.click(await screen.findByRole("button", { name: "Actions for prompts" }));

    expect(await screen.findByRole("menuitem", { name: "Rename this file" })).toBeTruthy();
    expect(useUiStore.getState().view).toBe("terminal");
  });

  it("removes one entry and leaves its neighbours alone", async () => {
    // Spliced out by its own byte range, which the parser reports — the same number a tick rewrites
    // into. A second way of deciding what an item IS would be a second place for the two to disagree.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Actions for first" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(notesApi.write).toHaveBeenCalledWith("github.com/a/b", "inbox", "- [ ] second\n");
    });
  });

  it("says where a note would land instead of just 'nothing here'", async () => {
    // Asked outright: "how do I create projects?" and "wo landen Eingaben die ich ins Note something
    // Feld tippe?". The empty state and the line above the field are the only places that can answer
    // either, and neither said anything.
    vi.mocked(notesApi.topics).mockResolvedValue([]);
    treeFromFixtures();
    renderTool();

    expect(await screen.findByText(/lands in this project's inbox/)).toBeTruthy();
    expect(screen.getByText(/files into github.com\/a\/b/)).toBeTruthy();
  });

  it("carries the entry's own position into the view", async () => {
    // The defect: every caller here KNEW the position and threw it away, so the note opened at the
    // top and the line just pressed had to be found again by reading the markdown — which is the one
    // thing pressing it was supposed to save. Reported as "sonst muss ich den punkt ja im markdown
    // suchen gehen".
    renderTool();
    await screen.findByText("second");

    fireEvent.click(screen.getByText("second"));

    const note = useUiStore.getState().note;
    expect(note?.at).toBeGreaterThan(0);
    // Shown, not edited: pressing a todo asks to be taken to it, not to be put in a text field.
    expect(note?.edit).toBe(false);
  });

  it("asks for the caret only where the caret was asked for", async () => {
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: "Actions for first" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit in the view" }));

    expect(useUiStore.getState().note?.edit).toBe(true);
  });

  it("imports into the project it is showing, and names no path", async () => {
    // The picker belongs to the backend: this side asks for a project and never learns which file
    // was chosen, which is what keeps ADR-PROJ-004's rule intact without an exception for imports.
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: /^Project:/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Import markdown files…" }));

    await waitFor(() => {
      expect(notesApi.import).toHaveBeenCalledWith("github.com/a/b");
    });
  });

  it("shows what was left behind, not only what came in", async () => {
    // The sentence that matters is the one about a picture that stayed outside the note's folder —
    // it is the one the user may want to act on, and a toast that fades in 1.8s cannot carry it.
    vi.mocked(notesApi.import).mockResolvedValue({
      picked: true,
      entries: [
        { file: "plan.md", topic: "plan", images: 2, skipped: [] },
        {
          file: "old.md",
          topic: null,
          images: 0,
          skipped: ["/etc/hosts is outside the note's own folder — left as a link"],
        },
      ],
    });
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: /^Project:/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Import markdown files…" }));

    const report = await screen.findByRole("region", { name: "What was imported" });
    expect(report.textContent).toContain("1 notes, 2 images");
    expect(report.textContent).toContain("outside the note's own folder");
  });

  it("says nothing at all when the dialog was closed", async () => {
    // Cancelling is not a result. A report saying "0 notes" about a dialog somebody dismissed reads
    // as a failure.
    vi.mocked(notesApi.import).mockResolvedValue({ picked: false, entries: [] });
    renderTool();
    await screen.findByText("first");

    fireEvent.click(screen.getByRole("button", { name: /^Project:/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Import markdown files…" }));

    await waitFor(() => {
      expect(notesApi.import).toHaveBeenCalled();
    });
    expect(screen.queryByRole("region", { name: "What was imported" })).toBeNull();
  });
});
