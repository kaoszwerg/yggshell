use std::process::Command;

fn main() {
    declare_config_env_as_a_build_input();
    refuse_a_release_built_against_the_dev_config();
    embed_build_metadata();
    tauri_build::build()
}

/// Stop a release build that is about to be compiled against the **dev** configuration.
///
/// `scripts/project/check-release-identity.mjs` already catches this — *after* the fact, and only on
/// the documented path (`npm run app:build`). It caught nothing when the build was started as a bare
/// `npx tauri build`, because nobody ran it: a poisoned 15 MB DMG was produced, handed over,
/// installed, and the app came up looking like a fresh install with every setting and every note
/// apparently gone. They were not gone; the binary was reading `…/com.kaoszwerg.yggshell.dev/`.
///
/// This is the same check moved to the only place that cannot be skipped — the compilation itself.
/// Whatever invokes cargo, `TAURI_CONFIG` naming the dev identifier in a release profile is now a
/// build error rather than an artefact that looks right from the outside.
///
/// Debug builds are left alone: that variable is exactly how `tauri dev --config` does its job.
fn refuse_a_release_built_against_the_dev_config() {
    if std::env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }
    let Ok(config) = std::env::var("TAURI_CONFIG") else {
        return;
    };
    let dev = include_str!("tauri.dev.conf.json");
    let Some(identifier) = json_string_field(dev, "identifier") else {
        return;
    };
    if config.contains(&identifier) {
        panic!(
            "TAURI_CONFIG names the dev identifier ({identifier}) and this is a release build.\n\
             The binary would resolve app_data_dir() to the DEV directory — a different settings \
             file, different notes, different logs — while the bundle looks entirely correct.\n\
             Build with `npm run app:build`, which strips the variable, or unset TAURI_CONFIG."
        );
    }
}

/// The value of a top-level `"key": "value"` pair, without pulling in a JSON crate for a build
/// script. The file it reads is ours and two lines long.
fn json_string_field(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = json.split_once(&needle)?.1;
    let rest = rest.split_once('"')?.1;
    let (value, _) = rest.split_once('"')?;
    Some(value.to_string())
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
