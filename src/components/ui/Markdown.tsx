import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { Copy, Pencil } from "lucide-react";
import { IconButton } from "./IconButton";
import { api } from "../../api/commands";
import { parseMarkdown, type Block, type Inline } from "../../lib/markdown";

/**
 * How an image in the document should be drawn, if the caller can draw one at all.
 *
 * A render prop rather than a rule inside this component, because the *policy* is not the renderer's:
 * a note draws an image out of its own repository and refuses to fetch a remote one until asked
 * (ADR-PROJ-004), while the About screen has no images and no business knowing any of that. Absent,
 * an image degrades to its alt text — which is what alt text is for.
 */
export type ImageRenderer = (src: string, alt: string) => ReactNode;

const ImageContext = createContext<ImageRenderer | null>(null);

/**
 * What to do with a link that does not leave the application.
 *
 * A note may point at another note — `[see](tmux.md)`. That is not a URL and never was: sending it to
 * `open_external` gets it refused for not being `http(s)`, which is correct of that guard and useless
 * to the reader. Given a handler, a relative target opens the thing it names; without one it renders
 * as plain text, which is what every other caller wants.
 *
 * Deliberately NOT a widening of the whitelist: nothing leaves the app, so there is no boundary here
 * to widen (ADR-PROJ-004).
 */
export type LocalLinkHandler = (target: string) => void;

const LocalLinkContext = createContext<LocalLinkHandler | null>(null);

/** Whether a link target is a URL at all, or a path inside whatever is being rendered. */
function isExternal(href: string): boolean {
  return href.includes("://") || href.startsWith("mailto:");
}

// Labels for the two per-block controls. Not through the message catalogue: this is a primitive in
// `ui/`, and a primitive that reaches for the app's translations is one that cannot be reused by a
// caller with none. The two words are the same in every language this app speaks, and the caller can
// still override them by wrapping — which no caller has needed.
const COPY_LABEL = "Copy";
const EDIT_LABEL = "Edit here";

/**
 * Render a markdown document.
 *
 * **Links go through the backend, never through the WebView.** An `<a href>` inside a Tauri window
 * *navigates the window* — the interface would be replaced by a web page, with no way back, and the
 * terminals behind it gone. Every link here is a control that asks the backend to open the user's
 * browser, which is the same route the terminal's own links take.
 *
 * **There is no markup path at all**, which is what makes the input's origin stop mattering. The
 * parser produces data and this component draws it; a raw `<script>` in a note is an `html` node and
 * renders as the text `<script>`. That was a nicety while the only input was two documents shipped in
 * the binary. It is load-bearing now that a note arrives by paste from anywhere (ADR-PROJ-004).
 *
 * **Every top-level block carries its source range as `data-md-start`/`data-md-end`**, which is what
 * lets a caller act on one block — copy it, or write at it — without this component knowing anything
 * about copying or editing.
 */
export function Markdown({
  source,
  className = "",
  style,
  image = null,
  onCopyBlock,
  onEditBlock,
  onLocalLink,
}: {
  source: string;
  className?: string;
  /** Forwarded to the container — the notes view puts the terminal's text size here
   *  (rule:content-size), once, rather than on every block. */
  style?: CSSProperties;
  image?: ImageRenderer | null;
  /**
   * Given, each block gets a copy control — the way documentation sites do it.
   *
   * Handed the block's own SOURCE rather than its rendered text: a code fence copied as rendered text
   * loses nothing, but a list copied that way loses its `-` and a heading its `#`, and the place this
   * is going is usually a prompt or a file where that matters.
   */
  onCopyBlock?: (source: string) => void;
  /**
   * Given, each block gets an "edit here" control beside its copy control.
   *
   * **Not a click on the block itself.** That was the first version and it fights everything the
   * block contains: a link, a checkbox, the copy control, selecting a sentence. An explicit affordance
   * says what it does and takes nothing away from the text — which is what the maintainer asked for
   * after living with the other one.
   */
  onEditBlock?: (at: number) => void;
  /** Given, a relative link opens what it names instead of being refused as a non-URL. */
  onLocalLink?: LocalLinkHandler;
}) {
  return (
    <ImageContext.Provider value={image}>
      <LocalLinkContext.Provider value={onLocalLink ?? null}>
        <div className={`text-xs leading-relaxed ${className}`.trim()} style={style}>
          {parseMarkdown(source).map((block, at) => (
            <div
              key={at}
              data-md-start={block.at.start}
              data-md-end={block.at.end}
              className={
                onCopyBlock === undefined && onEditBlock === undefined
                  ? undefined
                  : "group relative"
              }
            >
              <BlockView block={block} />
              {onCopyBlock === undefined && onEditBlock === undefined ? null : (
                // **Always there on a code block, on hover for everything else** — which is what
                // documentation sites do, and the reference the maintainer named. A copy control you
                // have to discover by waving the pointer over a fence is one nobody finds; a copy
                // control on every paragraph at all times is noise. Focus reveals them too, or these
                // would be controls only a mouse can reach.
                <span
                  className={`bg-deep/80 absolute top-0 right-0 flex gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${
                    block.kind === "fence" ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {onCopyBlock === undefined ? null : (
                    <IconButton
                      label={COPY_LABEL}
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => {
                        onCopyBlock(source.slice(block.at.start, block.at.end));
                      }}
                    >
                      <Copy size={11} aria-hidden />
                    </IconButton>
                  )}
                  {onEditBlock === undefined ? null : (
                    <IconButton
                      label={EDIT_LABEL}
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => {
                        onEditBlock(block.at.start);
                      }}
                    >
                      <Pencil size={11} aria-hidden />
                    </IconButton>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </LocalLinkContext.Provider>
    </ImageContext.Provider>
  );
}

/**
 * An image, drawn by whoever supplied a renderer — or its alt text.
 *
 * Never an `<img src>` straight from the document: a remote URL there would make the webview call a
 * stranger's server the moment the note is rendered, which is precisely what a tracking pixel counts
 * on (ADR-PROJ-004). The caller decides, and the caller is the only one who can.
 */
function ImageView({ src, alt }: { src: string; alt: string }) {
  const render = useContext(ImageContext);
  if (render === null) return <span className="text-dim/70">{alt === "" ? src : alt}</span>;
  return <>{render(src, alt)}</>;
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "rule") return <hr className="bg-cyan/15 my-3 h-px border-0" />;

  if (block.kind === "heading") {
    const size =
      block.level <= 1
        ? "text-cyan mt-4 mb-2 font-mono text-sm"
        : block.level === 2
          ? "text-cyan mt-4 mb-1.5 font-mono text-[13px]"
          : "text-green mt-3 mb-1 font-mono text-[11px] tracking-wide";
    // The level is data, so the element has to be chosen rather than interpolated — a heading tag
    // built from a variable is exactly what React refuses to type.
    const content = <InlineView runs={block.content} />;
    if (block.level <= 1) return <h2 className={`${size} first:mt-0`}>{content}</h2>;
    if (block.level === 2) return <h3 className={`${size} first:mt-0`}>{content}</h3>;
    return <h4 className={size}>{content}</h4>;
  }

  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className="mb-2 flex flex-col gap-1">
        {block.items.map((item, at) => (
          <li
            key={at}
            className={item.done === null ? "text-dim pl-3 -indent-3" : "text-dim flex gap-1.5"}
          >
            {item.done === null ? (block.ordered ? `${String(at + 1)}. ` : "• ") : null}
            {item.done === null ? null : (
              // Drawn, not a native checkbox — ADR-APP-026, and it is not interactive here either:
              // this component renders a document. Ticking writes to the file and belongs to whoever
              // owns it, which is why it is not wired in the renderer.
              <span aria-hidden className={item.done ? "text-green" : "text-dim/60"}>
                {item.done ? "\u2611" : "\u2610"}
              </span>
            )}
            <span className={item.done === true ? "line-through opacity-60" : undefined}>
              {item.blocks.map((child, childAt) => (
                <BlockView key={childAt} block={child} />
              ))}
            </span>
          </li>
        ))}
      </Tag>
    );
  }

  if (block.kind === "fence") {
    return (
      <pre className="bg-elevated mb-2 overflow-x-auto p-2 font-mono text-[11px]">
        <code className="text-fg">{block.code}</code>
      </pre>
    );
  }

  if (block.kind === "quote") {
    return (
      <blockquote className="border-cyan/25 mb-2 border-l-2 pl-2">
        {block.blocks.map((child, at) => (
          <BlockView key={at} block={child} />
        ))}
      </blockquote>
    );
  }

  if (block.kind === "html") {
    // As TEXT. The one line in this file that decides there is no sanitiser to get wrong.
    return (
      <pre className="text-dim/70 mb-2 font-mono text-[11px] whitespace-pre-wrap">{block.text}</pre>
    );
  }

  if (block.kind === "table") {
    return (
      // Scrolls on its own rather than pushing the panel wide: a licence table has long URLs in it,
      // and a settings page that scrolls sideways is a worse outcome than a table that does.
      <div className="mb-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {block.head.map((cell, at) => (
                <th
                  key={at}
                  className="border-cyan/20 text-fg border-b px-2 py-1 font-mono text-[11px] font-normal"
                >
                  <InlineView runs={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, at) => (
              <tr key={at}>
                {row.map((cell, cellAt) => (
                  <td key={cellAt} className="border-cyan/10 text-dim border-b px-2 py-1 align-top">
                    <InlineView runs={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <p className="text-dim mb-2">
      <InlineView runs={block.content} />
    </p>
  );
}

function InlineView({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, at) => {
        if (run.kind === "code") {
          return (
            <code
              key={at}
              className="bg-elevated text-fg rounded px-1 py-0.5 font-mono text-[11px]"
            >
              {run.text}
            </code>
          );
        }
        if (run.kind === "strong") {
          return (
            <strong key={at} className="text-fg font-semibold">
              {run.text}
            </strong>
          );
        }
        if (run.kind === "emphasis") {
          return (
            <em key={at} className="text-fg/90">
              {run.text}
            </em>
          );
        }
        if (run.kind === "strike") {
          return (
            <s key={at} className="opacity-60">
              {run.text}
            </s>
          );
        }
        if (run.kind === "link") {
          return <LinkView key={at} text={run.text} href={run.href} />;
        }
        if (run.kind === "image") {
          return <ImageView key={at} alt={run.alt} src={run.src} />;
        }
        return <span key={at}>{run.text}</span>;
      })}
    </>
  );
}

/**
 * A link, as a control rather than as an anchor.
 *
 * `<a href>` in a Tauri window navigates the window away from the app. This asks the backend to open
 * the browser instead — the same route the terminal's own links take, and the same place a refused
 * or malformed URL is rejected.
 */
function LinkView({ text, href }: { text: string; href: string }) {
  const local = useContext(LocalLinkContext);

  // A link INTO the document set never reaches the URL guard, because it is not a URL: it opens the
  // thing it names, inside the app. Nothing leaves, so there is no boundary being widened here.
  if (!isExternal(href) && local !== null) {
    return (
      <button
        type="button"
        className="text-cyan hover:text-glow-cyan cursor-pointer underline decoration-dotted underline-offset-2"
        onClick={() => {
          local(href);
        }}
      >
        {text}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="text-cyan hover:text-glow-cyan cursor-pointer underline decoration-dotted underline-offset-2"
      onClick={() => {
        // try/catch AND .catch: an IPC call can fail either way — synchronously when the bridge is
        // not there, asynchronously when the backend refuses the URL — and only one of the two is
        // caught by a promise handler. An escape from here reaches `window.onerror` and puts the
        // whole interface behind the fatal screen, over a link (ADR-APP-032).
        // try/catch AND .catch: an IPC call can fail either way — synchronously when the bridge is
        // not there, asynchronously when the backend refuses the URL — and a promise handler catches
        // only one of them. An escape from a click handler reaches `window.onerror` and puts the
        // whole interface behind the fatal screen, over a link (ADR-APP-032).
        //
        // Not covered by a test: the runner counts ANY rejection raised inside a listener as an
        // unhandled error, whether or not this code catches it, so such a test would assert the
        // runner's behaviour rather than ours. Verified by hand instead — the handler logs and the
        // interface stays up.
        try {
          void api.openExternal(href).catch((error: unknown) => {
            console.error("could not open a link", href, error);
          });
        } catch (error) {
          console.error("could not open a link", href, error);
        }
      }}
    >
      {text}
    </button>
  );
}
