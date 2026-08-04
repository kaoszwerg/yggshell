import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";

const LABELS = {
  back: "Back",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Fit to the window",
  actual: "Actual size",
};

function mount(over: Partial<Parameters<typeof ImageViewer>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <ImageViewer
      src="data:image/png;base64,AAAA"
      alt="a screenshot"
      onClose={onClose}
      labels={LABELS}
      {...over}
    />,
  );
  return { onClose, ...view };
}

/**
 * Mount the viewer and state the sizes a real browser would have measured.
 *
 * jsdom lays nothing out: `naturalWidth` and `clientWidth` are 0 for everything, so the fit — which
 * is the whole arithmetic here — has nothing to work from unless a test supplies it.
 */
function measure(natural: { w: number; h: number }, box: { w: number; h: number }) {
  const { onClose } = mount();
  const image = document.querySelector("img");
  const surface = screen.getByRole("img", { name: "a screenshot" });
  if (image === null) throw new Error("no image");
  Object.defineProperty(image, "naturalWidth", { value: natural.w, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: natural.h, configurable: true });
  Object.defineProperty(surface, "clientWidth", { value: box.w, configurable: true });
  Object.defineProperty(surface, "clientHeight", { value: box.h, configurable: true });
  fireEvent.load(image);
  return { image, onClose };
}

describe("ImageViewer", () => {
  it("shrinks a picture that is larger than the window", () => {
    const { image } = measure({ w: 2000, h: 1000 }, { w: 1000, h: 800 });

    expect(image.style.transform).toContain("scale(0.5)");
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("never blows a small picture up to fill", () => {
    // An 80px icon stretched across the window shows less than the icon does — "fit" would then be a
    // worse view than the one in the note it was opened from.
    const { image } = measure({ w: 80, h: 80 }, { w: 1000, h: 800 });

    expect(image.style.transform).toContain("scale(1)");
  });

  it("zooms with the wheel", () => {
    const { image } = measure({ w: 1000, h: 1000 }, { w: 1000, h: 1000 });
    const surface = screen.getByRole("img", { name: "a screenshot" });

    fireEvent.wheel(surface, { deltaY: -1 });

    expect(image.style.transform).toContain("scale(1.25)");
  });

  it("moves with a drag", () => {
    const { image } = measure({ w: 1000, h: 1000 }, { w: 1000, h: 1000 });
    const surface = screen.getByRole("img", { name: "a screenshot" });
    // jsdom has no pointer capture.
    surface.setPointerCapture = vi.fn();
    surface.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { clientX: 160, clientY: 130 });

    expect(image.style.transform).toContain("translate(60px, 30px)");
  });

  it("goes to actual size and back to fitted", () => {
    const { image } = measure({ w: 2000, h: 2000 }, { w: 500, h: 500 });
    expect(image.style.transform).toContain("scale(0.25)");

    fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    expect(image.style.transform).toContain("scale(1)");

    fireEvent.click(screen.getByRole("button", { name: "Fit to the window" }));
    expect(image.style.transform).toContain("scale(0.25)");
  });

  it("leaves on Escape from the state it opened in, on the backdrop, and on the way back", () => {
    const { onClose, container } = mount();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);

    // The visible control is a BACK arrow at the left, not a red cross at the top right: that spot
    // and that accent belong to the window's own close button, and putting one there had people
    // believing the viewer would quit the application.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps the keys it handles away from everything else on the window", () => {
    // The reason the ladder never worked: the notes view has its OWN Escape listener on this window,
    // registered first and therefore run first — so the picture went back to fitted and the whole
    // view vanished behind it a moment later. A modal has to own the keys it uses.
    const elsewhere = vi.fn();
    window.addEventListener("keydown", elsewhere);
    mount();

    // On an element inside the document, which is where a real keystroke lands: the event then
    // travels window -> target -> window, and the capture listener is the first thing it meets.
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "+" });

    expect(elsewhere).not.toHaveBeenCalled();
    window.removeEventListener("keydown", elsewhere);
  });

  it("leaves every other key alone, because a modal is not a keyboard trap", () => {
    // ⌘Q and the window's own keys are not this component's to eat.
    const elsewhere = vi.fn();
    window.addEventListener("keydown", elsewhere);
    mount();

    fireEvent.keyDown(document.body, { key: "q", metaKey: true });

    expect(elsewhere).toHaveBeenCalled();
    window.removeEventListener("keydown", elsewhere);
  });

  it("steps out of the zoom BEFORE it steps out of the viewer", () => {
    // Reported: at 400% in a corner, Escape threw the whole view away — the largest possible answer
    // to "I have zoomed in too far". The control back to fitted existed, and that is the point: a
    // way back that has to be found is not a way back.
    const { image, onClose } = measure({ w: 2000, h: 1000 }, { w: 1000, h: 800 });
    const surface = screen.getByRole("img", { name: "a screenshot" });

    fireEvent.wheel(surface, { deltaY: -1 });
    expect(image.style.transform).toContain("scale(0.625)");

    fireEvent.keyDown(window, { key: "Escape" });

    // Back to the whole picture, and the viewer is still open.
    expect(image.style.transform).toContain("scale(0.5)");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns to the whole picture on a double-click, and to 1:1 from there", () => {
    const { image } = measure({ w: 2000, h: 1000 }, { w: 1000, h: 800 });
    const surface = screen.getByRole("img", { name: "a screenshot" });

    fireEvent.doubleClick(surface); // fitted already -> go to actual size
    expect(image.style.transform).toContain("scale(1)");

    fireEvent.doubleClick(surface); // moved -> back to fitted
    expect(image.style.transform).toContain("scale(0.5)");
  });

  it("counts a pan as moved, so Escape recentres before it closes", () => {
    // Dragging at the fitted scale leaves the picture off-centre without changing the zoom. Escape
    // closing there would answer "I nudged it" by discarding the view.
    const { onClose } = mount();
    const surface = screen.getByRole("img", { name: "a screenshot" });
    surface.setPointerCapture = vi.fn();
    surface.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(surface, { clientX: 50, clientY: 0 });
    fireEvent.pointerUp(surface, { clientX: 50, clientY: 0 });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("zooms about the pointer without the picture flying off", () => {
    // The defect this pins: the offset used to be set from INSIDE the `setScale` updater, and an
    // updater runs in the render phase, where React invokes it more than once on purpose. The
    // correction was applied twice per notch and the picture shot off the surface — reported as
    // zooming and panning simply not working.
    const { image } = measure({ w: 1000, h: 1000 }, { w: 1000, h: 1000 });
    const surface = screen.getByRole("img", { name: "a screenshot" });
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      configurable: true,
    });

    // 100px right of the centre; one notch in. The point under the pointer stays under it, so the
    // picture moves by exactly (1 - 1.25) × 100 = -25.
    fireEvent.wheel(surface, { deltaY: -1, clientX: 600, clientY: 500 });

    expect(image.style.transform).toContain("scale(1.25)");
    expect(image.style.transform).toContain("translate(-25px, 0px)");
  });

  it("zooms and moves from the keyboard, which needs no pointer at all", () => {
    const { image } = measure({ w: 1000, h: 1000 }, { w: 1000, h: 1000 });

    fireEvent.keyDown(window, { key: "+" });
    expect(image.style.transform).toContain("scale(1.25)");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(image.style.transform).toContain("translate(-60px, 0px)");

    fireEvent.keyDown(window, { key: "0" });
    expect(image.style.transform).toContain("scale(1)");
    expect(image.style.transform).toContain("translate(0px, 0px)");
  });

  it("names the picture once, not twice", () => {
    // The surface carries the accessible name; a screen reader reading the `img` as well would
    // announce the same thing again.
    mount();

    expect(screen.getByRole("img", { name: "a screenshot" })).toBeTruthy();
    expect(document.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
  });
});
