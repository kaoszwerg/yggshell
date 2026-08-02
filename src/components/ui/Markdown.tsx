import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/commands";
import { parseMarkdown, type Block, type Inline } from "../../lib/markdown";

/**
 * Render one of the app's own markdown documents.
 *
 * **Links go through the backend, never through the WebView.** An `<a href>` inside a Tauri window
 * *navigates the window* — the interface would be replaced by a web page, with no way back, and the
 * terminals behind it gone. Every link here is a control that asks the backend to open the user's
 * browser, which is the same route the terminal's own links take.
 *
 * **There is no markup path at all**, which is what makes the input's origin stop mattering. The
 * parser produces data and this component draws it; a raw `<script>` in a note is a `html` node and
 * renders as the text `<script>`. That was a nicety while the only input was two documents shipped in
 * the binary. It is load-bearing now that a note arrives by paste from anywhere (ADR-PROJ-004).
 *
 * **Every top-level block carries its source range as `data-md-start`/`data-md-end`.** That is what
 * lets a reader turn a click into "edit *this*, here" without the renderer knowing anything about
 * editing: one handler on the container reads the nearest such element. Making each block interactive
 * instead would have nested a hundred buttons around the links already inside them, which is both an
 * accessibility violation and invalid HTML.
 */
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

export function Markdown({
  source,
  className = "",
  style,
  image = null,
}: {
  source: string;
  className?: string;
  /** Forwarded to the container — the notes view puts the terminal's text size here
   *  (rule:content-size), once, rather than on every block. */
  style?: CSSProperties;
  image?: ImageRenderer | null;
}) {
  return (
    <ImageContext.Provider value={image}>
      <div className={`text-xs leading-relaxed ${className}`.trim()} style={style}>
        {parseMarkdown(source).map((block, at) => (
          <div key={at} data-md-start={block.at.start} data-md-end={block.at.end}>
            <BlockView block={block} />
          </div>
        ))}
      </div>
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
