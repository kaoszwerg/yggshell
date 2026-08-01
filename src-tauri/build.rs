use std::process::Command;

fn main() {
    declare_config_env_as_a_build_input();
    embed_build_metadata();
    tauri_build::build()
}

/// Make `TAURI_CONFIG` a build input, because it decides **which app this binary is**.
///
/// `tauri dev --config src-tauri/tauri.dev.conf.json` exports its merged configuration into the
/// environment as `TAURI_CONFIG`, and `tauri build` reads the same variable — so a release built in
/// the shell you had just tested in is compiled against the *dev* configuration. The bundle still
/// looks right from the outside; what changes is `app_data_dir()`, which resolves from the
/// compiled-in identifier. The app then reads and writes the dev directory: a different settings
/// file, different themes, different logs, and not one error anywhere. It cost an install and a
/// diagnosis session.
///
/// **Cargo cannot see that on its own.** An environment variable is not a file, so without this line
/// it happily reuses the poisoned artefact even after the variable is gone — which is exactly what
/// happened on the first attempt to fix this: the build command was corrected, and the binary did not
/// change. Declaring it means unsetting the variable actually rebuilds.
///
/// Belt and braces, deliberately: `npm run app:build` strips the variable, this makes a change to it
/// invalidate the build, and `scripts/project/check-release-identity.mjs` refuses a release binary
/// that still carries the dev identifier.
fn declare_config_env_as_a_build_input() {
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
}

/// Embed git commit + build date as compile-time env vars so every build is traceable to a commit
/// (ADR-CORE-024), even between releases when the SemVer version is unchanged. Falls back to "unknown"
/// when git is unavailable (e.g. a source tarball without `.git`).
fn embed_build_metadata() {
    // Rebuild when the checked-out commit or the index (staged changes) changes.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");

    let sha = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let build_date =
        git(&["show", "-s", "--format=%cI", "HEAD"]).unwrap_or_else(|| "unknown".into());

    println!("cargo:rustc-env=GIT_SHA={sha}");
    println!("cargo:rustc-env=GIT_DIRTY={dirty}");
    println!("cargo:rustc-env=BUILD_COMMIT_DATE={build_date}");
}

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
