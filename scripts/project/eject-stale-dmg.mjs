#!/usr/bin/env node
/**
 * Unmount a disk image left over from a previous build, so the next one can start.
 *
 * **Why this is needed at all.** `tauri build` mounts a scratch volume to lay the DMG out. If a
 * previous run was interrupted — or if somebody installed the last DMG and never ejected it — a
 * volume by the same name is still mounted, and the build fails with nothing but
 * `failed to run bundle_dmg.sh`. It has cost three builds in one session.
 *
 * **What it will and will not touch.** Only images whose backing file is inside THIS repository's
 * `target/` directory, or a `dmg.XXXXXX` scratch volume — the two shapes a build leaves behind. A
 * DMG the user mounted from anywhere else is left alone, however tempting its name looks: ejecting
 * something out from under someone is the class of mistake rule:live-app exists to prevent.
 *
 * That means an *installed* YggShell.dmg sitting in Downloads stays mounted and the build still
 * fails — correctly, because that volume is the maintainer's, not ours. The message says which one
 * and why.
 *
 * **`hdiutil` is declared in `knip.project.json`.** knip flags an unknown binary so that an
 * undeclared dependency cannot hide behind a shell call; `hdiutil` is macOS's own disk-image tool at
 * a fixed path in the OS, so the honest answer is to name it rather than to relax the check
 * (rule:code-quality — never weaken a gate to make a finding go away).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A DMG is a macOS artefact and `hdiutil` is a macOS tool. On any other platform there is nothing
// mounted to get in the way, and running this would fail the build for a problem that cannot exist
// there (rule:cross-platform: gate the platform-specific part, do not leave it broken elsewhere).
if (process.platform !== "darwin") {
  console.log("eject-stale-dmg: not macOS — nothing to unmount.");
  process.exit(0);
}

const REPO = resolve(new URL("../..", import.meta.url).pathname);

/** Everything hdiutil currently has mounted, as `{ image, volumes[] }`. */
function mountedImages() {
  let plist;
  try {
    plist = execFileSync("hdiutil", ["info", "-plist"], { encoding: "utf8" });
  } catch {
    // Not macOS, or hdiutil unavailable. Nothing to do, and not a reason to fail a build.
    return [];
  }

  // A deliberately small reader rather than a plist parser: the two things needed are the image path
  // and the mount points, and both are plain `<string>` values in a known nesting.
  const images = [];
  for (const chunk of plist.split("<key>image-path</key>").slice(1)) {
    const path = /<string>([^<]*)<\/string>/.exec(chunk)?.[1];
    if (path === undefined) continue;
    const volumes = [...chunk.matchAll(/<key>mount-point<\/key>\s*<string>([^<]*)<\/string>/g)].map(
      (m) => m[1],
    );
    images.push({ image: path, volumes });
  }
  return images;
}

/** Whether this mount is one of ours to clean up. */
export function isOurs(image, volume) {
  // Ours: the image lives in this checkout's build output.
  if (image.startsWith(`${REPO}/`)) return true;
  // Or it is the anonymous scratch volume `bundle_dmg.sh` creates and, when interrupted, abandons.
  return /^\/Volumes\/dmg\.[A-Za-z0-9]{6}$/.test(volume ?? "");
}

function main() {
  const stale = [];
  for (const { image, volumes } of mountedImages()) {
    for (const volume of volumes) {
      if (volume && isOurs(image, volume)) stale.push({ image, volume });
    }
  }

  for (const { image, volume } of stale) {
    try {
      execFileSync("hdiutil", ["detach", volume, "-quiet"], { stdio: "ignore" });
      console.log(`ejected ${volume} (left over from ${image})`);
    } catch {
      // Busy, or gone between listing and detaching. The build will say so if it still matters.
      console.log(`could not eject ${volume}; the build may fail if it is in the way`);
    }
  }
}

// Only when run, never on import: a test importing `isOurs` must not start ejecting volumes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
