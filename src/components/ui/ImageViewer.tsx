import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize2, Minus, Plus } from "lucide-react";
import { IconButton } from "./IconButton";

/**
 * An image that opens when it is clicked.
 *
 * **It lives here because it is a control the user touches** (ADR-APP-026, rule:ui-design): a raw
 * `<button>` in a view is lint-rejected, and rightly — the picture is the affordance, so the picture
 * is a primitive. What *opening* means belongs to the caller, which is why this raises `onOpen`
 * rather than owning the viewer itself; a note has to fetch a bigger copy first.
 */
export function ZoomableImage({
  src,
  alt,
  label,
  onOpen,
  className = "",
}: {
  src: string;
  alt: string;
  /** What the control does, for anyone not looking at the picture. */
  label: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className="block cursor-zoom-in border-0 bg-transparent p-0"
    >
      <img src={src} alt={alt} className={className} />
    </button>
  );
}

/** How far in and out the viewer will go, and the step a button takes. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 12;
const STEP = 1.25;

/** How far an arrow key moves the picture, in pixels. */
const PAN = 60;

/**
 * The keys the viewer takes while it is open — and only these.
 *
 * Listed rather than "swallow everything": ⌘Q and the window's own keys are not this component's to
 * eat, and a modal that quietly disables the application's keyboard is its own kind of trap.
 */
const HANDLED = new Set([
  "Escape",
  "+",
  "=",
  "-",
  "0",
  "1",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

export interface ImageViewerProps {
  /** The image itself, already loaded — a data URL, because this app's webview cannot read a file. */
  src: string;
  /** What the image is, for anyone who cannot see it. Also the viewer's accessible name. */
  alt: string;
  /** Free text under the controls: which file this is, how big it is. */
  caption?: string;
  onClose: () => void;
  /** Labels, because a primitive does not reach into the catalogue itself (rule:i18n). */
  labels: { back: string; zoomIn: string; zoomOut: string; fit: string; actual: string };
}

/**
 * One image, as large as the window allows, and movable.
 *
 * **Why a viewer rather than a bigger `<img>`.** A note's images are drawn at the width of the
 * column, which is right for reading and useless for looking: a screenshot of a stack trace arrives
 * unreadable, and a Retina capture is drawn at half its pixels. Enlarging it *in place* is worse than
 * it sounds — the text below is pushed off the screen, and anything wider than the pane can then only
 * be reached by scrolling the note sideways.
 *
 * So the image gets its own surface, and the note is left alone.
 *
 * **Nothing was added to build it.** The zoom is a CSS transform, the pan is two numbers, and the
 * chrome is the HUD's own controls — a viewer library would bring its own look to a place that
 * already has one (ADR-APP-026, rule:dependencies).
 *
 * **It opens at the size that shows the whole picture**, then gets out of the way: the wheel zooms
 * about the pointer, dragging moves. A small image opens at its natural size instead of being
 * stretched to fill — an 80 px icon blown up to a wall of blur is not "showing" it.
 *
 * **Getting back out is a ladder, not a cliff.** Escape returns to the whole picture while the view
 * is zoomed or moved, and leaves the viewer only once it is back where it opened; a double-click
 * does the same, because that is the gesture people try first. Escape used to close outright, which
 * meant the answer to "I have zoomed in too far" was to throw the view away and open it again.
 */
export function ImageViewer({ src, alt, caption, onClose, labels }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  // State rather than a ref, because the cursor is drawn from it — and a ref read during render is
  // a value React was never told changed.
  const [dragging, setDragging] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  /** Draw the whole image, centred — the state the viewer opens in and returns to. */
  const fit = () => {
    const box = surface.current;
    const img = image.current;
    if (box === null || img === null || img.naturalWidth === 0) return;
    const ratio = Math.min(
      box.clientWidth / img.naturalWidth,
      box.clientHeight / img.naturalHeight,
    );
    // Shrunk to fit, never blown up to fill: an 80px icon stretched across the window shows less
    // than the icon does, and "fit" would then be a worse view than the one in the note.
    setScale(clamp(Math.min(ratio, 1)));
    setOffset({ x: 0, y: 0 });
    setFitted(true);
  };

  /**
   * Zoom, optionally about a point rather than the centre.
   *
   * **Both values are computed here and set once each.** The first version called `setOffset` from
   * *inside* the `setScale` updater — and an updater runs in the render phase, where a second
   * setState is not a supported thing to do: React invokes updaters more than once (deliberately, in
   * development), so the offset was applied twice per notch and the picture shot off the surface.
   * Zooming looked broken because it was.
   *
   * Reading `scale` and `offset` from the closure is right in an event handler: they are the values
   * that were on screen when the event happened, which is exactly what the pointer position refers to.
   */
  const zoom = (by: number, about?: { x: number; y: number }) => {
    const next = clamp(scale * by);
    if (next === scale) return;
    // About the pointer, because zooming into the middle when the thing you are looking at is in a
    // corner means chasing it with the mouse afterwards.
    if (about !== undefined) {
      const factor = next / scale;
      setOffset({
        x: about.x - (about.x - offset.x) * factor,
        y: about.y - (about.y - offset.y) * factor,
      });
    }
    setScale(next);
    setFitted(false);
  };

  /** Whether the view has been moved off the state it opened in. */
  const moved = !fitted || offset.x !== 0 || offset.y !== 0;

  /**
   * Escape steps **out of the zoom first, and only then out of the viewer**.
   *
   * Reported, and it is the obvious complaint once you are at 400% in a corner: Escape is the key
   * everybody reaches for to undo the last thing, and it was doing the largest thing available —
   * throwing away the whole view to answer "I zoomed in too far". The control that returns to fitted
   * was there the whole time, which is exactly the point: if the way back has to be *found*, it is
   * not the way back.
   *
   * The same ladder the notes view already climbs: two presses at most from anywhere in here, and
   * neither of them something to know in advance.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ours = HANDLED.has(event.key);
      if (!ours) return;
      // **The viewer owns these keys while it is open, and it has to say so.** There is another
      // Escape listener on this same window — the notes view leaves for the terminal on it — and it
      // was registered first, so it ran first: the picture went back to fitted and the whole view
      // vanished behind it a moment later. The ladder could never be climbed.
      //
      // Capture, so this runs before anything bubbling can act, and stopped there.
      event.preventDefault();
      event.stopPropagation();
      // And `stopImmediatePropagation` as well: a real keystroke targets the focused element, so the
      // capture phase above already wins — but an event dispatched AT the window puts every listener
      // in the target phase, where registration order decides and `stopPropagation` alone stops
      // nothing. Both, so the rule holds however the key arrives.
      event.stopImmediatePropagation();

      switch (event.key) {
        case "Escape":
          if (moved) fit();
          else onClose();
          return;
        // The keyboard path, and not only for accessibility: it is the one route that does not
        // depend on a wheel, a trackpad gesture or a pointer the platform reports the way we hope.
        case "+":
        case "=":
          zoom(STEP);
          return;
        case "-":
          zoom(1 / STEP);
          return;
        case "0":
          fit();
          return;
        case "1":
          setScale(1);
          setOffset({ x: 0, y: 0 });
          setFitted(false);
          return;
        // Arrows move the picture, in the steps a scroll would.
        case "ArrowLeft":
          setOffset((at) => ({ x: at.x + PAN, y: at.y }));
          return;
        case "ArrowRight":
          setOffset((at) => ({ x: at.x - PAN, y: at.y }));
          return;
        case "ArrowUp":
          setOffset((at) => ({ x: at.x, y: at.y + PAN }));
          return;
        case "ArrowDown":
          setOffset((at) => ({ x: at.x, y: at.y - PAN }));
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // `fit` and `zoom` are rebuilt every render and read the current values; including them would
    // re-arm the listener on every notch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, moved, scale, offset]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85"
      role="presentation"
      onClick={(event) => {
        // The backdrop closes; the image and the controls do not, so a drag that ends outside the
        // picture does not dismiss the thing being looked at.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="border-cyan/15 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        {/* **The way out is a back arrow, at the left.** It was a red X at the top right — which is
            where this window's own close button lives, in the same accent, so it read as "quit the
            app" and nobody dared press it. Reported exactly that way. The notes view already puts
            its way out here as a back arrow, and a viewer is a surface you leave, not a window you
            destroy: same gesture, same place, same icon. */}
        <IconButton
          label={labels.back}
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={onClose}
        >
          <ArrowLeft size={13} aria-hidden />
        </IconButton>
        <span className="text-dim min-w-0 flex-1 truncate font-mono text-[11px]">
          {caption ?? alt}
        </span>
        <span className="text-dim/70 shrink-0 font-mono text-[10px]">
          {Math.round(scale * 100)}%
        </span>
        <IconButton
          label={labels.zoomOut}
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={() => {
            zoom(1 / STEP);
          }}
        >
          <Minus size={13} aria-hidden />
        </IconButton>
        <IconButton
          label={labels.zoomIn}
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={() => {
            zoom(STEP);
          }}
        >
          <Plus size={13} aria-hidden />
        </IconButton>
        <IconButton
          label={fitted ? labels.actual : labels.fit}
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={() => {
            if (fitted) {
              setScale(1);
              setOffset({ x: 0, y: 0 });
              setFitted(false);
            } else fit();
          }}
        >
          <Maximize2 size={13} aria-hidden />
        </IconButton>
      </header>

      {/* `overflow-hidden`, because the image is moved by transform rather than by scrolling: a
          scroll container would fight the drag and the wheel would do two things at once. */}
      <div
        ref={surface}
        role="img"
        aria-label={alt}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        // What every image viewer does, and the reason it is worth copying: it is the gesture people
        // already try when they have zoomed too far, so the way back needs no looking for.
        onDoubleClick={() => {
          if (moved) fit();
          else {
            setScale(1);
            setOffset({ x: 0, y: 0 });
            setFitted(false);
          }
        }}
        onWheel={(event) => {
          const box = surface.current?.getBoundingClientRect();
          zoom(
            event.deltaY < 0 ? STEP : 1 / STEP,
            box === undefined
              ? undefined
              : {
                  x: event.clientX - box.left - box.width / 2,
                  y: event.clientY - box.top - box.height / 2,
                },
          );
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from === null) return;
          setOffset({ x: event.clientX - from.x, y: event.clientY - from.y });
        }}
        onPointerUp={(event) => {
          drag.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <img
          ref={image}
          src={src}
          alt=""
          // The wrapper carries the accessible name; announcing the image again would read it twice.
          aria-hidden
          draggable={false}
          onLoad={fit}
          className="absolute top-1/2 left-1/2 max-w-none origin-center select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${String(offset.x)}px, ${String(offset.y)}px) scale(${String(scale)})`,
          }}
        />
      </div>
    </div>
  );
}
