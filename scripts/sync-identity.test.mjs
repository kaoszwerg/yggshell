// @vitest-environment node
// Tests for the identity SSOT sync (ADR-APP-031): app.identity.json is authoritative and is written
// into every derived location — the manifests, both Tauri configs, the TS constants, the page title
// AND every Rust source that names the library crate.
//
// The Rust half is the part that used to be forgotten. `src-tauri/examples/` was not in the rewrite
// set, so a renamed fork kept calling `old_lib::…` there: `cargo clippy --all-targets` broke on the
// first build after the rename — in the same breath as `identity:check` reporting that everything
// matched. Everything here runs against a temp repo — never the real one (rule:testing).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rustCrateRefTargets, syncIdentity, withCrateRefs } from "./sync-identity.mjs";

const IDENTITY = {
  displayName: "Yggshell",
  binaryName: "yggshell",
  packageName: "yggshell",
  crateName: "yggshell",
  identifier: "com.example.yggshell",
  vendor: "example",
  tagline: "A shell",
  description: "A desktop shell.",
};

const FIXTURES = {
  "app.identity.json": JSON.stringify(IDENTITY, null, 2),
  "package.json": JSON.stringify(
    { name: "old-app", version: "1.0.0", description: "Old." },
    null,
    2,
  ),
  "src-tauri/Cargo.toml": `[package]
name = "old_app"
version = "0.1.0"
description = "Old."
default-run = "old-app"

[lib]
name = "old_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "old-app"
path = "src/main.rs"

[dependencies]
tauri = "2.11.2"
`,
  "src-tauri/tauri.conf.json": JSON.stringify(
    {
      productName: "Old App",
      mainBinaryName: "old-app",
      identifier: "com.example.oldapp",
      app: { windows: [{ title: "Old App" }] },
    },
    null,
    2,
  ),
  "src-tauri/tauri.dev.conf.json": JSON.stringify(
    { productName: "Old App Dev", identifier: "com.example.oldapp.dev" },
    null,
    2,
  ),
  "src/lib/app.ts": `export const APP_NAME = "Old App";
export const APP_TAGLINE = "Old tagline";
export const APP_DESCRIPTION = "Old.";
`,
  "index.html": `<!doctype html><html><head><title>Old App</title></head><body></body></html>`,
  "src-tauri/src/main.rs": `fn main() {
    old_app_lib::run()
}
`,
  "src-tauri/tests/contracts.rs": `use old_app_lib::dto::SettingsDto;
use old_app_lib::error::AppError;
`,
  "src-tauri/examples/crash_probe.rs": `fn main() {
    old_app_lib::crash::set_data_dir(std::path::Path::new("x"));
    old_app_lib::crash::install_panic_hook();
}
`,
};

let root;

/** Materialise a minimal repo in a temp dir; `omit` leaves a target out entirely. */
function repo({ omit = [], extra = {} } = {}) {
  for (const [rel, content] of Object.entries({ ...FIXTURES, ...extra })) {
    if (omit.includes(rel)) continue;
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-identity-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("withCrateRefs", () => {
  it("rewrites every reference form, not just `use`", () => {
    const out = withCrateRefs("use old_lib::a;\nfn m() { old_lib::b::c() }\n", "new_lib");

    expect(out).toBe("use new_lib::a;\nfn m() { new_lib::b::c() }\n");
  });

  it("leaves a crate that is already current untouched", () => {
    expect(withCrateRefs("use new_lib::a;", "new_lib")).toBe("use new_lib::a;");
  });
});

describe("rustCrateRefTargets", () => {
  it("discovers every example next to the fixed entry points", () => {
    repo({ extra: { "src-tauri/examples/second_probe.rs": "fn main() {}\n" } });

    expect(rustCrateRefTargets(root)).toEqual([
      "src-tauri/src/main.rs",
      "src-tauri/tests/contracts.rs",
      "src-tauri/examples/crash_probe.rs",
      "src-tauri/examples/second_probe.rs",
    ]);
  });

  it("ignores non-Rust files in the examples dir", () => {
    repo({ extra: { "src-tauri/examples/README.md": "# not rust\n" } });

    expect(rustCrateRefTargets(root)).not.toContain("src-tauri/examples/README.md");
  });

  it("copes with a project that has no examples at all", () => {
    repo({ omit: ["src-tauri/examples/crash_probe.rs"] });

    expect(rustCrateRefTargets(root)).toEqual([
      "src-tauri/src/main.rs",
      "src-tauri/tests/contracts.rs",
    ]);
  });
});

describe("syncIdentity", () => {
  it("rewrites the crate reference in an example — the rename regression", () => {
    // Without this, `cargo clippy --all-targets` fails on the first build after a rename, while
    // identity:check reports that every derived location matches.
    repo();

    syncIdentity({ root });

    expect(read("src-tauri/examples/crash_probe.rs")).toContain(
      "yggshell_lib::crash::set_data_dir",
    );
    expect(read("src-tauri/examples/crash_probe.rs")).not.toContain("old_app_lib");
  });

  it("reports a stale example as drift in check mode", () => {
    repo();
    syncIdentity({ root });
    // Exactly the state a fork ends up in when only the example is missed.
    fs.writeFileSync(
      path.join(root, "src-tauri/examples/crash_probe.rs"),
      FIXTURES["src-tauri/examples/crash_probe.rs"],
    );

    const result = syncIdentity({ root, check: true });

    expect(result.drift).toEqual(["src-tauri/examples/crash_probe.rs"]);
  });

  it("picks up an example added later, with no change to this script", () => {
    repo({ extra: { "src-tauri/examples/added_later.rs": "fn main() { old_app_lib::run() }\n" } });

    syncIdentity({ root });

    expect(read("src-tauri/examples/added_later.rs")).toBe("fn main() { yggshell_lib::run() }\n");
  });

  it("writes the identity into every other derived location", () => {
    repo();

    const result = syncIdentity({ root });

    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("yggshell");
    expect(pkg.description).toBe("A desktop shell.");
    expect(pkg.version).toBe("1.0.0"); // the version is NOT this script's business (ADR-CORE-024)

    const cargo = read("src-tauri/Cargo.toml");
    expect(cargo).toContain('name = "yggshell"');
    expect(cargo).toContain('name = "yggshell_lib"');
    expect(cargo).toContain('default-run = "yggshell"');
    expect(cargo).toContain('description = "A desktop shell."');
    expect(cargo).toContain('tauri = "2.11.2"'); // dependencies untouched

    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.productName).toBe("Yggshell");
    expect(conf.mainBinaryName).toBe("yggshell");
    expect(conf.identifier).toBe("com.example.yggshell");
    expect(conf.app.windows[0].title).toBe("Yggshell");

    const dev = JSON.parse(read("src-tauri/tauri.dev.conf.json"));
    expect(dev.productName).toBe("Yggshell Dev");
    expect(dev.identifier).toBe("com.example.yggshell.dev");

    expect(read("src/lib/app.ts")).toContain('APP_NAME = "Yggshell"');
    expect(read("src/lib/app.ts")).toContain('APP_TAGLINE = "A shell"');
    expect(read("index.html")).toContain("<title>Yggshell</title>");
    expect(read("src-tauri/src/main.rs")).toContain("yggshell_lib::run()");
    expect(read("src-tauri/tests/contracts.rs")).toContain("use yggshell_lib::dto::SettingsDto;");

    expect(result.written).toContain("src-tauri/examples/crash_probe.rs");
    expect(result.drift).toEqual([]);
  });

  it("is a no-op once everything matches", () => {
    repo();
    syncIdentity({ root });

    const result = syncIdentity({ root });

    expect(result.written).toEqual([]);
  });

  it("never writes in check mode", () => {
    repo();
    const before = read("src-tauri/examples/crash_probe.rs");

    const result = syncIdentity({ root, check: true });

    expect(result.drift.length).toBeGreaterThan(0);
    expect(result.written).toEqual([]);
    expect(read("src-tauri/examples/crash_probe.rs")).toBe(before);
  });

  it("skips a derived location the project does not have", () => {
    repo({ omit: ["index.html", "src-tauri/tests/contracts.rs"] });

    const result = syncIdentity({ root });

    expect(result.checked).not.toContain("index.html");
    expect(result.checked).toContain("src-tauri/examples/crash_probe.rs");
  });

  it("fails loudly when app.identity.json is missing", () => {
    repo({ omit: ["app.identity.json"] });

    expect(() => syncIdentity({ root })).toThrow(/app\.identity\.json/);
  });
});
