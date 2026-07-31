import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { labelShells } from "../../lib/shellLabels";
import {
  useDeleteTerminalProfile,
  useSaveTerminalProfile,
  useShells,
  useTerminalProfiles,
  useTerminalThemes,
} from "../../hooks/useSettings";
import type { TerminalProfile } from "../../bindings/TerminalProfile";

/** A profile that overrides nothing — every field falls through to Settings. */
const blank = (): TerminalProfile => ({
  id: "",
  name: "New profile",
  shell: null,
  cwd: null,
  theme: null,
});

/**
 * Terminal profiles: a named set of overrides for what a new tab starts as.
 *
 * **Everything here is an override, and the settings above are the defaults.** A profile that sets
 * only a colour scheme takes its shell from Settings, and changing Settings changes it — there is no
 * second copy to keep in step (ADR-CORE-005). That is why every control offers a "default" option
 * rather than being pre-filled with the current setting: pre-filling would silently freeze today's
 * value into the profile.
 */
export function ProfileControls() {
  const profiles = useTerminalProfiles();
  const [editing, setEditing] = useState<TerminalProfile | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Profiles</span>
        <div className="flex flex-wrap gap-1">
          {(profiles.data ?? []).length === 0 ? (
            <span className="text-dim/60 font-mono text-xs">None yet.</span>
          ) : (
            (profiles.data ?? []).map((profile) => (
              <Button key={profile.id} onClick={() => setEditing({ ...profile })}>
                {profile.name}
              </Button>
            ))
          )}
        </div>
        <span className="text-dim text-xs">
          Right-click the tab strip to start a terminal from one. A tab keeps the profile it was
          opened with — it decided which shell is running, so changing it under a live tab would be
          a claim about a process that is not true.
        </span>
      </div>

      <div>
        <Button accent="green" onClick={() => setEditing(blank())}>
          New profile
        </Button>
      </div>

      {editing === null ? null : (
        <ProfileEditor profile={editing} onEdited={setEditing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  onEdited,
  onClose,
}: {
  profile: TerminalProfile;
  onEdited: (profile: TerminalProfile) => void;
  onClose: () => void;
}) {
  const save = useSaveTerminalProfile();
  const remove = useDeleteTerminalProfile();
  const shells = useShells();
  const themes = useTerminalThemes();
  const choices = labelShells(shells.data ?? []);

  return (
    <div className="hud-clip-sm border-cyan/20 flex flex-col gap-3 border p-3">
      <div className="flex items-center gap-2">
        <TextField
          aria-label="Profile name"
          value={profile.name}
          placeholder="Profile name"
          className="max-w-xs font-mono"
          onChange={(e) => onEdited({ ...profile, name: e.target.value })}
        />
        {profile.id === "" ? null : (
          <Button accent="danger" onClick={() => remove.mutate(profile.id, { onSuccess: onClose })}>
            <Trash2 size={13} strokeWidth={2.5} aria-hidden /> Delete
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Shell</span>
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={profile.shell === null}
            active={profile.shell === null}
            onClick={() => onEdited({ ...profile, shell: null })}
          >
            Default
          </Button>
          {choices.map((choice) => (
            <Button
              key={choice.path}
              aria-pressed={profile.shell === choice.path}
              active={profile.shell === choice.path}
              onClick={() => onEdited({ ...profile, shell: choice.path })}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs">Colour scheme</span>
        <div className="flex flex-wrap gap-1">
          <Button
            aria-pressed={profile.theme === null}
            active={profile.theme === null}
            onClick={() => onEdited({ ...profile, theme: null })}
          >
            Default
          </Button>
          {(themes.data ?? []).map((theme) => (
            <Button
              key={theme.id}
              aria-pressed={profile.theme === theme.id}
              active={profile.theme === theme.id}
              onClick={() => onEdited({ ...profile, theme: theme.id })}
            >
              {theme.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-dim text-xs" htmlFor="profile-cwd">
          Start in
        </label>
        <TextField
          id="profile-cwd"
          value={profile.cwd ?? ""}
          placeholder="the shell's own default"
          className="max-w-md font-mono"
          onChange={(e) => onEdited({ ...profile, cwd: e.target.value })}
        />
        <span className="text-dim text-xs">
          An absolute path. It is validated when a terminal opens — a directory that has since gone
          means the terminal starts where the shell would have, not that it refuses to start.
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          accent="green"
          disabled={profile.name.trim() === ""}
          onClick={() => save.mutate(profile, { onSuccess: onClose })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        {save.isError ? (
          <span className="text-danger self-center font-mono text-xs">{String(save.error)}</span>
        ) : null}
      </div>
    </div>
  );
}
