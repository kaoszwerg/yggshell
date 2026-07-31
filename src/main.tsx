import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/orbitron/600.css";
import App from "./App";
import { CrashBoundary } from "./components/CrashBoundary";
import { FatalScreen } from "./components/FatalScreen";
import { installGlobalCrashHandlers, reportCrash } from "./lib/crash";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

// The UI is its own entry point (ADR-CORE-037, ADR-APP-032): the Rust panic hook cannot see anything
// thrown in here, so the webview installs its own last-resort handlers — before the first render, so
// that a failure during the initial mount is caught too. That failure is the one a user would otherwise
// meet as a blank window.
const missingMount = document.getElementById("root") === null;
const mount =
  document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
const reactRoot = ReactDOM.createRoot(mount);

/** Replace whatever is on screen with the fatal screen. The failed tree is discarded, never resumed. */
const showFatal = (error: unknown, reportPath: string | null) =>
  reactRoot.render(<FatalScreen error={error} reportPath={reportPath} />);

installGlobalCrashHandlers(showFatal);

// The main window is transparent so its chamfered corners reveal the desktop.
document.body.classList.add("main-window");

if (missingMount) {
  // `index.html` did not contain the mount point this bundle is built against — the artefact is not
  // what we shipped, so we do not run the app on top of it. Previously this was a bare `throw` at
  // module scope: no log, no record, no window, on a build with no console attached.
  const error = new Error("mount point #root is missing from index.html");
  void reportCrash("uncaught", error).then((reportPath) => showFatal(error, reportPath));
} else {
  reactRoot.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <CrashBoundary>
          <App />
        </CrashBoundary>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
