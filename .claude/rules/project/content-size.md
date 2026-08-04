---
id: rule:content-size
title: Content follows the user's settings; chrome does not
tldr: Anything that renders content follows the user's text size — useContentFontSize on the surface, relative units within it. Never a fixed px. Chrome stays fixed.
scope: project
load: core
triggers:
  [
    tool,
    widget,
    panel,
    sidebar,
    font,
    font-size,
    text-size,
    size,
    scale,
    zoom,
    settings,
    readable,
    accessibility,
    px,
    rem,
    em,
    tailwind,
    heading,
    markdown,
    primitive,
    component,
    view,
    render,
    text,
    typography,
  ]
applies-to:
  ["src/components/tools/**", "src/components/ui/**", "src/views/**", "src/hooks/useContentFontSize.ts"]
type: project
---

# Content follows the settings; chrome does not

A user who turns the terminal's text up has told this app how big they need text to be. A panel
beside it drawn at a hard-coded `11px` is the app deciding it knows better — and the smaller the
panel, the more certain it is that they turned it up *for* that panel.

**This was got wrong on five tools at once**, and it was reported before it was noticed: Files,
Activity, Docker, Agent and its sub-panels all carried fixed sizes, while the Git detail panel had
followed the setting since the day it was built. Same app, two answers.

## The rule

- **Content is drawn at `useContentFontSize()`** — the same `terminal_font_size` the emulator and the
  diff use. Content is anything that reads like a terminal: a file tree, a process list, a container
  name, a log, a commit message, a path, a count.
- **Chrome keeps its fixed size.** Section headings, hints, the small print, a button's label. It is
  interface rather than content, and a heading that grew with the code would compete with it.
- **The size goes on the scroll region**, once, not on every row. One `style={{ fontSize }}` at the
  top of the content and the rows inherit it; a size repeated per row is a size that will be
  forgotten on the sixth one.
- **Never divide by the UI scale.** That is native WebView zoom (ADR-APP-021) and it already applies
  to ordinary DOM. Dividing would shrink the panels as the rest of the interface grew — the exact
  opposite of what the user asked for. Only the *emulator* divides, because xterm sizes its own grid.
- **Inside content, sizes are RELATIVE.** The surface sets the size once; everything within it says
  how it compares — `text-[1.3em]`, not `text-[13px]`. A fixed size in there does not merely ignore
  the setting, it **inverts** it: turn the text up and the fixed thing becomes the smallest thing on
  the page.

## This applies to the PRIMITIVES, not only the tools

The rule was written after five tools got it wrong, so it reads as if tools were the subject. They
are not. **Anything that renders content is the subject**, and a shared primitive is the worst place
to get it wrong, because it is wrong everywhere at once and nobody owns the mistake.

Measured, 2026-08-04: `components/ui/Markdown.tsx` drew its headings at `14px`, `13px` and `11px`.
The notes view sets the terminal's size on the scroll region exactly as this rule says — so with the
text turned up, **every heading was smaller than the paragraph under it.** The one element whose job
is to stand out was the least prominent thing on the page, in the app's own markdown renderer, used
by the notes, the Credits and the Changelog. Reported as *"die H tags müssen jeweils größer
rendern"*; nobody had to report the inversion, because by then it just looked broken.

The fix is the `em` above, and it costs nothing anywhere else: relative sizes follow whatever
container they land in, so the same component is right inside a note at the terminal's size and
inside Settings at Settings' size, with no second decision.

## Why this is `load: core`

**The failure emits no vocabulary.** Somebody writing `text-sm` on a heading is not thinking about a
font-size setting and will never search for a rule about one — which is exactly what happened here:
this rule already listed `src/components/ui/**` in its `applies-to`, and it did not fire, because
nobody looked it up for a two-line change to a heading. A rule that is only found by those who
already suspect it is a rule for people who do not need it.

So it is in context from the start, and it does not have to be asked for once per widget. The
maintainer's words when that failed for the second time are the requirement: *"ich will nicht bei
jeder änderung und jedem widget nochmal sagen müssen dass sie auf ui und textgröße reagieren
müssen"*.

## Prove it, per surface

A hook that is imported and never reaches the DOM looks identical from the outside. Each tool gets
one test:

```tsx
vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
// …
const sized = container.querySelector<HTMLElement>("[style*='font-size']");
expect(sized?.style.fontSize).toBe("17px");
```

A **primitive** cannot be tested that way — it has no setting of its own, by design. What it can be
held to is the *relationship*, which is the part that was broken:

```tsx
// Each level larger than the one below, in relative units — the numbers are a judgement, the
// ordering is the contract (`components/ui/Markdown.test.tsx`).
expect(size("One")).toBeGreaterThan(size("Two"));
```

## Why this is a rule and not a lint

The line between content and chrome is a judgement — `text-[10px]` on a section heading is right and
on a file name is wrong, and no pattern distinguishes them. A lint banning fixed sizes in
`components/tools/**` would be wrong about half the matches, and a check that is wrong half the time
gets suppressed (ADR-CORE-039: a noisy tool lowers the real posture while raising the nominal one).

The test above is the enforceable half, and it is required per tool.

**Why:** the settings exist because the maintainer's eyes, screen and distance are not the
developer's. A component that hard-codes a size has quietly overruled that — and it is the kind of
defect nobody files as a bug, they just find the app slightly unpleasant.

**How to apply:** building or touching a tool, take the size from `useContentFontSize()` and put it
on the scroll region. Ask of each element: *would this be in a terminal?* If yes it is content. See
[[surfaces]] for what a tool is in the first place.
