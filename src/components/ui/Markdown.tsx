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
 * The input is ours and ships inside the binary, so there is no untrusted markup to sanitise; that is
 * also why the parser produces data rather than HTML (`lib/markdown`).
 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`text-xs leading-relaxed ${className}`.trim()}>
      {parseMarkdown(source).map((block, at) => (
        <BlockView key={at} block={block} />
      ))}
    </div>
  );
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
    return (
      <ul className="mb-2 flex flex-col gap-1">
        {block.items.map((item, at) => (
          <li key={at} className="text-dim pl-3 -indent-3">
            {"• "}
            <InlineView runs={item} />
          </li>
        ))}
      </ul>
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
        if (run.kind === "link") {
          return <LinkView key={at} text={run.text} href={run.href} />;
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
