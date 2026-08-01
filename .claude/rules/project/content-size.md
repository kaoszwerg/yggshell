---
id: rule:content-size
title: Content follows the user's settings; chrome does not
tldr: A tool's monospace content is drawn at terminal_font_size via useContentFontSize, never a hard-coded px. Chrome stays fixed. Pin it with a test.
scope: project
load: conditional
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
    tailwind,
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

## Prove it, per tool

A hook that is imported and never reaches the DOM looks identical from the outside. Each tool gets
one test:

```tsx
vi.mock("../../hooks/useContentFontSize", () => ({ useContentFontSize: () => 17 }));
// …
const sized = container.querySelector<HTMLElement>("[style*='font-size']");
expect(sized?.style.fontSize).toBe("17px");
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
