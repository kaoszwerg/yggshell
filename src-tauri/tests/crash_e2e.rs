//! The panic path, executed for real (ADR-CORE-037, ADR-APP-032).
//!
//! Everything else about crash handling is unit-tested, but the one thing that mattered most — that a
//! panic actually *reaches* the hook, actually *writes* the report and actually *exits* with the code
//! that says so — cannot be tested in-process: it ends the process. So we run a process that panics
//! (`examples/crash_probe.rs`) and inspect the corpse.
//!
//! `rule:verification`: run the real thing; a passing unit test is not a demonstration that the feature
//! works.

use std::path::PathBuf;
use std::process::Command;

/// The probe binary, next to this test's own executable: `target/<profile>/examples/crash_probe`.
/// `cargo test` builds examples, so it is there whenever this test runs.
fn probe_binary() -> PathBuf {
    let mut path = std::env::current_exe().expect("the test's own exe path");
    path.pop(); // .../deps/<test>.exe  ->  .../deps
    if path.ends_with("deps") {
        path.pop(); // -> target/<profile>
    }
    path.push("examples");
    path.push(if cfg!(windows) {
        "crash_probe.exe"
    } else {
        "crash_probe"
    });
    path
}

#[test]
fn a_panic_writes_a_report_and_exits_with_the_panic_code() {
    let probe = probe_binary();
    assert!(
        probe.is_file(),
        "crash_probe is not at {}.\n\
         Cargo builds examples for a full `cargo test` (which is what `npm run rust:test` runs), but \
         NOT for an isolated `cargo test --test crash_e2e`. Run the whole suite.",
        probe.display()
    );

    let data_dir = tempfile::tempdir().expect("tempdir");
    let output = Command::new(&probe)
        .arg(data_dir.path())
        // Suppress ONLY the modal dialog — a message box would block this test forever. Everything
        // else on the crash path still runs, and that is exactly what we are asserting on.
        .env("NO_CRASH_DIALOG", "1")
        .output()
        .expect("the probe process must run");

    // 1. It exits DELIBERATELY, with the code that says "panic" — not 0, and not whatever the runtime
    //    would have chosen for us.
    assert_eq!(
        output.status.code(),
        Some(101),
        "a panic must exit with EXIT_PANIC (101); got {:?}. stderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    // 2. It leaves a durable, on-device record — the file a user can actually send us.
    let crashes = data_dir.path().join("crashes");
    let reports: Vec<PathBuf> = std::fs::read_dir(&crashes)
        .unwrap_or_else(|e| panic!("no crashes dir at {}: {e}", crashes.display()))
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| p.extension().is_some_and(|e| e == "log"))
        .collect();
    assert_eq!(reports.len(), 1, "exactly one crash report: {reports:?}");

    // 3. The record carries what makes the crash debuggable: the message, where it happened, a stack.
    let body = std::fs::read_to_string(&reports[0]).expect("read the report");
    assert!(
        body.contains("probe panic — the failure the hook must report"),
        "the report must carry the panic message:\n{body}"
    );
    assert!(body.contains("kind:    panic"), "the report names the kind");
    assert!(
        body.contains("crash_probe.rs"),
        "the report names the location"
    );
    assert!(
        body.contains("backtrace:"),
        "the report carries a backtrace"
    );

    // 4. It leaves the marker the NEXT launch reads, so a crash with no window still reaches the user.
    assert!(
        crashes.join("pending").is_file(),
        "the pending marker must survive the crash"
    );
}
