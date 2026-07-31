//! A process whose only job is to die (ADR-APP-032).
//!
//! The panic path is the one thing a unit test cannot exercise in-process: it ends with
//! `std::process::exit`, which would take the test runner down with it. So the test
//! (`tests/crash_e2e.rs`) runs THIS binary instead, lets it panic for real, and then inspects what it
//! left behind — the crash report on disk, and the exit code.
//!
//! Without it, the most important path in the whole shell would be the only one never executed.

fn main() {
    let dir = std::env::args()
        .nth(1)
        .expect("usage: crash_probe <data-dir>");

    saga_rust_template_lib::crash::set_data_dir(std::path::Path::new(&dir));
    saga_rust_template_lib::crash::install_panic_hook();

    panic!("probe panic — the failure the hook must report");
}
