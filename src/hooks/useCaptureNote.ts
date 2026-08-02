import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi } from "../api/notes";
import { useNoteProject } from "./useNoteProject";
import { useToastStore } from "../store/toast";

/**
 * File a note from wherever the user happens to be looking.
 *
 * **Capture must be one gesture, or the staging area is one you stop using.** What you are looking at
 * when the thought arrives — a file path, a commit, the directory a terminal is in — should become a
 * note *where it is*, not after a trip to another panel and a retype. That is the half of this feature
 * the original description left out entirely, and the half without which it is a text editor in a
 * sidebar.
 *
 * It lands in the current project's inbox, because choosing a topic is a second gesture; filing it
 * properly is a deliberate act for later, on the page that has room for it.
 */
export function useCaptureNote() {
  const project = useNoteProject();
  const qc = useQueryClient();
  const notify = useToastStore((s) => s.notify);

  return useMutation({
    mutationFn: (text: string) => notesApi.capture(project, text),
    onSuccess: () => {
      // Confirmed on screen for the same reason a copy is: filing a note is invisible, and a capture
      // that silently did nothing cannot be told from one that worked.
      notify("notes.captured");
      void qc.invalidateQueries({ queryKey: ["notes-content"] });
      void qc.invalidateQueries({ queryKey: ["notes-projects"] });
    },
    onError: (error: unknown) => {
      console.warn("could not file the note", error);
      notify("notes.captureFailed", "error");
    },
  });
}
