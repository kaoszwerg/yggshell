import { useEffect, useRef } from "react";
import { HudPanel } from "./HudPanel";
import { Button } from "./Button";

/**
 * Ask before doing something that cannot be undone.
 *
 * **The primitive exists because the alternative is banned.** `window.confirm` is stock OS chrome
 * (ADR-APP-026, rule:ui-design) and is lint-gated out of this codebase — so a destructive action
 * either gets a HUD dialog or it gets no confirmation at all, and the second is how a build gets
 * killed by a mis-click.
 *
 * **The confirming button carries the danger accent, and it is not the default focus.** The dialog
 * opens with the cancel button focused, so a stray Enter — the key most likely to be in flight when a
 * dialog appears — cancels rather than confirms. That asymmetry is the whole point of asking.
 */
export function ConfirmDialog({
  label,
  question,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  /** Accessible name of the dialog. */
  label: string;
  /** The question, in one line the user can answer without reading further. */
  question: string;
  /** What will actually happen — the part that makes the answer informed. Optional. */
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Escape and the backdrop, when "dismiss" is not the same answer as the cancel button.
   *
   * Usually it is, and this is left out. It is not when the question has **three** outcomes rather
   * than two — closing a tab is close-and-keep, close-and-end, or don't close — where the two buttons
   * take the first two and walking away has to mean the third. Without this, Escape would silently
   * perform an action the user was backing out of.
   */
  onDismiss?: () => void;
}) {
  const dismiss = onDismiss ?? onCancel;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
      role="presentation"
      onClick={(e) => {
        // A backdrop click DISMISSES. Same reasoning as the focus: the ambiguous gesture takes the
        // branch that undoes least.
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="w-full max-w-sm" role="dialog" aria-modal="true" aria-label={label}>
        <HudPanel accent="danger" label={label}>
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs leading-relaxed">{question}</p>
            {detail === undefined ? null : (
              <p className="text-dim font-mono text-[10px] leading-relaxed">{detail}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button ref={cancelRef} onClick={onCancel} className="px-3 py-1 text-xs">
                {cancelLabel}
              </Button>
              <Button accent="danger" onClick={onConfirm} className="px-3 py-1 text-xs">
                {confirmLabel}
              </Button>
            </div>
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
