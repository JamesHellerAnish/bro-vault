// scripts/cap-presync.mjs
//
// Runs before every `cap sync`. It creates two directories that Capacitor requires to exist
// but never creates itself, and whose absence produces a failure that looks like something
// else entirely.
//
// `android/app/src/main/assets/` is the important one. fe-gmq's docs/vendor-app-capacitor.md
// records the symptom: without it, `cap add android`'s automatic sync aborts before plugin
// registration, so `android/capacitor.settings.gradle` is never written -- and since
// `android/settings.gradle` applies that file unconditionally, Gradle then fails at settings
// evaluation with "Could not read script ... as it does not exist". Nothing in that error
// mentions a missing assets directory. Reproduced exactly here on first `cap add android`.
//
// `out/` is Capacitor's `webDir`. It is unused in live-URL mode but the schema requires it,
// and sync refuses to run without it. It is also gitignored (it is a build artifact name), so
// a fresh clone would hit the same failure again -- which is precisely why this is a script
// and not a line in the README asking someone to remember.

import { mkdirSync, writeFileSync, existsSync } from "node:fs"

const dirs = ["out", "android/app/src/main/assets"]

for (const dir of dirs) {
  mkdirSync(dir, { recursive: true })
}

// Capacitor copies webDir's contents into the APK. In live-URL mode nothing there is ever
// loaded -- the WebView goes straight to server.url -- but an empty directory keeps sync quiet.
if (!existsSync("out/.gitkeep")) {
  writeFileSync("out/.gitkeep", "Capacitor webDir placeholder. Unused in live-URL mode.\n")
}

console.log("cap-presync: required directories present")
