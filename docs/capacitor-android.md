# Android app (Capacitor)

`PLAN.md` §9's Phase 4. Live-URL mode, per §13 — the native shell is a scoped WebView over
the deployed site, not a bundled static export, so every web deploy is live in the installed
app with no Play Store resubmission.

Most of what follows was paid for once already, in `fe-gmq`'s
`docs/vendor-app-capacitor.md`. Where a gotcha came from there it is marked **[fe-gmq]**;
where this app hit something new it is marked **[new]**.

---

## Status

| | |
|---|---|
| `android/` platform | added, committed |
| Plugins registered | app, preferences, push-notifications, splash-screen, status-bar |
| Server URL | env-driven, production by default |
| Push | client-side registration wired; **needs `google-services.json`** |
| APK built | **no** — no Android SDK on the build machine |
| Run on a device | **no** |

The Android project exists and syncs cleanly. Nothing has been compiled or installed.

---

## Prerequisites

| Need | This machine has |
|---|---|
| Node ≥ 22 | 24.14.1 ✓ |
| **JDK 21** | **17 ✗ — must be upgraded** |
| Android SDK | **absent ✗** |
| Android Studio | absent (supplies both of the above) |

Installing Android Studio provides the SDK and a bundled JDK. **[fe-gmq]** Gradle will not
find a JDK on its own — point `JAVA_HOME` at Android Studio's bundled one. On Windows:

```bash
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

**[fe-gmq]** `android/local.properties` (gitignored, machine-specific) must contain
`sdk.dir=<path to Android SDK>`. Android Studio's setup wizard writes it on first open; if
building headless before ever opening Studio, create it by hand.

---

## Everyday commands

```bash
pnpm cap:sync
```

```bash
pnpm cap:open
```

Re-run `cap:sync` after adding any Capacitor plugin — that is what regenerates
`capacitor.settings.gradle` with the new native module included.

### Pointing the app at a dev machine

The committed default is production. To aim the shell somewhere else, set an environment
variable — never edit `capacitor.config.ts`:

```bash
CAP_SERVER_URL=http://10.0.2.2:3000 pnpm cap:sync
```

`10.0.2.2` is the Android emulator's alias for the host's localhost. For a physical device on
the same Wi-Fi, use the host's LAN IP (`http://192.168.1.42:3000`).

**Run `pnpm cap:sync` with no env var before building anything you intend to ship.** The
config bakes into `android/app/src/main/assets/capacitor.config.json` at sync time.

---

## The decisions

### The dev-URL footgun is fixed structurally, not by a comment

`fe-gmq`'s `capacitor.config.ts` is committed to this day with
`url: 'http://10.0.2.2:3000/partner'`, `cleartext: true`, under a comment reading *"TEMPORARY
— revert before any real build/commit"*. It was not reverted. `PLAN.md` §13 flags it as a
live issue: any APK from that checkout points at a dev server and shows a blank screen on a
real device, with plaintext HTTP enabled.

A comment asking a human to remember is not a mitigation — it already failed once, in the
codebase we are copying from. So here:

- the dev URL is **not a value in the file at all**; it comes from `CAP_SERVER_URL`
- `cleartext` is **derived** from whether the resolved URL is `http://`, never hand-written
- if someone ever edits the production constant to an `http://` address, the config **throws**
  at sync time rather than quietly producing a plaintext build

Verified both ways: with the env var set the baked config is
`{"url":"http://10.0.2.2:3000","androidScheme":"http","cleartext":true}`; without it,
`{"url":"https://app.myinsurancebro.com","androidScheme":"https"}` and no cleartext key. The
default — what a forgetful build produces — is the safe one.

### `allowNavigation` is deliberately empty

Capacitor's Android `WebViewClient` opens any URL that does not match the server host
externally, as an Intent. That default is exactly what this app needs:

- **`wa.me`** — §6 Option A is the entire messaging strategy; the link must hand off to the
  installed WhatsApp. Listing `wa.me` in `allowNavigation` would instead load WhatsApp Web
  *inside* our WebView, logged out and useless.
- **`tel:` / `mailto:`** — dialler and mail app, via the same mechanism.
- **`*.supabase.co`** — signed document URLs should open in the system browser so downloads
  land in the device's Downloads folder.

So the correct value is nothing at all. Written down because "we forgot" and "we decided"
look identical in a diff.

### `POST_NOTIFICATIONS` had to be added by hand **[new]**

`@capacitor/push-notifications` merges its own `MessagingService` into the manifest but
**not** the runtime permission — confirmed by reading the plugin's own
`AndroidManifest.xml`, which declares only the service. On Android 13+ its absence means
`requestPermissions()` can never return `granted`, and it fails silently rather than with a
useful error.

`CAMERA` is deliberately *not* declared. The Docs tab uses a plain `<input type="file">`,
which Capacitor serves with the system picker; declaring CAMERA would show users a permission
prompt and invite a Play Store data-safety question for a capability nothing uses. Add
`@capacitor/camera` (which merges its own permissions) when native capture is wanted.

### The missing-assets-directory trap, encoded as a script **[fe-gmq]**

`cap add android` printed `sync could not run--missing out directory`, and left
`android/capacitor.settings.gradle` ungenerated — while `android/settings.gradle` line 5
applies that file unconditionally. Gradle would have failed at settings evaluation with
`Could not read script ... as it does not exist`, an error mentioning nothing about assets
directories. Reproduced here exactly as `fe-gmq` documented it.

The fix is to create `android/app/src/main/assets/` and re-sync. But `out/` is gitignored (it
is a build-artifact name), so a fresh clone would hit it again — which is why this lives in
`scripts/cap-presync.mjs`, wired into `cap:sync` and `cap:open`, rather than in this document
as something to remember. Verified by deleting both directories and running `pnpm cap:sync`
from scratch.

### `android/` is committed

In live-URL mode it is a thin shell, but it still carries the manifest, permissions, icons and
Gradle config; regenerating per machine would silently drop those. `.gitignore` excludes only
the machine-specific and secret parts: `local.properties`, build output, `.gradle/`, the
copied web assets, and `google-services.json`.

Note `capacitor.settings.gradle` contains pnpm store paths with version hashes. Same lockfile
→ same paths, so it is reproducible — but always run `pnpm cap:sync` after `pnpm install`
rather than trusting the committed copy.

### Capacitor stays out of the web bundle **[new]**

The same build serves the browser and the WebView, so the native code must not cost web
users anything. `useNativeShell.ts` therefore reads `window.Capacitor` directly rather than
importing `@capacitor/core`, and every plugin is a dynamic import inside a
`isNativePlatform()` guard.

Verified structurally rather than assumed, the same way the Recharts split was in Phase 5:
the authenticated layout's eager chunk contains **zero** occurrences of `@capacitor/core`,
`registerPlugin`, `WebPlugin` or `com.capacitorjs`. The only matches are the strings
`isNativePlatform` and `PushNotifications` — identifiers from this repo's own guard code, not
the library. The library itself lands in a separate lazy chunk that a browser never fetches.

(Worth noting the check was nearly misread: a naive grep for "capacitor" hits this repo's own
variable names. The library markers are the ones that mean anything.)

### `webDir` warning is expected **[fe-gmq]**

`webDir: "out"` is required by the config schema and unused in live-URL mode. Sync copies an
empty directory into the APK; nothing there is ever loaded. Do not "fix" this by switching to
a static export — that would mean abandoning SSR and middleware.

---

## Push notifications — what remains

Client side is wired (`lib/native/useNativeShell.ts`) and the token store exists
(`…001400_device_tokens.sql`). Still needed:

1. A **Firebase project**, with an Android app registered as `com.myinsurancebro.app`.
2. `google-services.json` dropped at `android/app/google-services.json` (gitignored — supply
   per environment).
3. The Google Services Gradle plugin in `android/build.gradle` and `android/app/build.gradle`.
   Capacitor does not add these; Firebase's console prints the exact lines.
4. A **sending** Edge Function. §2 already establishes `pg_cron` → Edge Function as this
   project's scheduler. It reads `device_tokens` with the service role, bypassing RLS.

**The shared-device hazard is already handled in the schema.** An FCM token identifies a
device, not a person — when a company phone is re-issued to another broker, a plain INSERT
would collide and the device would keep delivering the *previous* broker's lead assignments
and client names. `register_device_token()` reassigns the token to whoever presents it, since
presenting it is proof of holding the device. See the migration header.

---

## Known WebView behaviours to check on a real device

None of these are verified — there is no device and no APK. Listed so the first run has a
checklist rather than a vibe:

| Behaviour | Expectation | Risk |
|---|---|---|
| `wa.me` deep link | opens WhatsApp app | if it loads in-WebView, `allowNavigation` is wrong |
| `tel:` link | opens dialler | — |
| CSV export | **likely broken** | blob + `<a download>` is commonly ignored in an Android WebView. Already flagged in `lib/csv.ts`; wants `@capacitor/filesystem` + Share if it matters in-app |
| Signed document URL | opens in system browser | `window.open(_blank)` |
| File input (Docs tab) | system picker | camera capture degraded without `@capacitor/camera` |
| Session persistence | survives app restart | Supabase writes persistent cookies via `@supabase/ssr`; WebView `CookieManager` should retain them, but this is the single most likely thing to be wrong |
| Safe areas | no content under notch | theme already ships `env(safe-area-inset-*)` helpers and `viewportFit: cover` |
| Back button | WebView history | **[fe-gmq]** no custom handling on purpose — Capacitor's Android shell already calls `goBack()` |

---

## Bigger caveat

The app the shell points at **has no working backend yet**. No Supabase project exists, no
migrations have been applied, and `app.myinsurancebro.com` is not deployed. Installing this
APK today would show the login screen and fail at OTP.

The wrap is genuinely complete and independent of that — but "the Android app is done" and
"the Android app works" remain different claims until the database exists and the site is
deployed.
