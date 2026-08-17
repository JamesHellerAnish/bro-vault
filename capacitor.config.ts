import type { CapacitorConfig } from "@capacitor/cli"

// Live-URL mode. The native shell is a scoped WebView over the deployed site rather than a
// bundled static export -- PLAN.md section 13's reason applies here exactly as it did for
// fe-gmq: this is a full SSR Next.js app with dynamic routes and middleware, so bundling
// would mean reworking the rendering model purely for the wrapper. It also means every web
// deploy is live in the installed app instantly, with no Play Store resubmission.
//
// ---------------------------------------------------------------------------
// THE DEV-URL FOOTGUN, FIXED STRUCTURALLY
// ---------------------------------------------------------------------------
// fe-gmq's capacitor.config.ts is committed with the Android emulator URL
// (http://10.0.2.2:3000/partner, cleartext: true) under a comment reading "TEMPORARY --
// revert before any real build/commit". It was not reverted. PLAN.md section 13 flags it as
// a live issue: any APK built from that checkout points at a local dev server and shows a
// blank screen on a real device, with cleartext HTTP enabled.
//
// A comment asking a human to remember is not a mitigation -- it already failed once, in the
// codebase we are copying from. So the dev URL is not a value in this file at all. The
// committed default is production; pointing at a dev machine requires setting an environment
// variable, which cannot be accidentally committed:
//
//   CAP_SERVER_URL=http://10.0.2.2:3000 pnpm cap:sync     # emulator against local dev
//   CAP_SERVER_URL=http://192.168.1.42:3000 pnpm cap:sync # physical device on the same LAN
//   pnpm cap:sync                                          # production -- the default
//
// cleartext is likewise derived, never written by hand: it is enabled only when the resolved
// URL is actually http://, so a production build cannot ship with it on.
// ---------------------------------------------------------------------------

const PRODUCTION_URL = "https://app.myinsurancebro.com"

const serverUrl = process.env.CAP_SERVER_URL || PRODUCTION_URL
const isCleartext = serverUrl.startsWith("http://")

if (isCleartext && !process.env.CAP_SERVER_URL) {
  // Unreachable while PRODUCTION_URL is https, and that is the point -- if someone ever
  // edits the constant to an http:// address, the build fails loudly instead of quietly
  // shipping an APK that talks to a plaintext host.
  throw new Error("Refusing to build: the default server URL must be https://")
}

const config: CapacitorConfig = {
  appId: "com.myinsurancebro.app",
  appName: "MyInsuranceBro",

  // Required by the config schema but genuinely unused in live-URL mode. `cap sync` warns
  // "missing out directory" every run; that warning is expected and harmless (fe-gmq
  // documents the same thing). Do not "fix" it by switching to a static export.
  webDir: "out",

  server: {
    url: serverUrl,
    androidScheme: isCleartext ? "http" : "https",
    ...(isCleartext ? { cleartext: true } : {}),
  },

  plugins: {
    SplashScreen: {
      // The web app draws its own splash (BrokerSplash) while the auth check runs, so the
      // native one only needs to cover the WebView's first paint. Leaving it up longer means
      // two splash screens in a row, which reads as a slow app.
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#1E4E9C",
      androidSpinnerStyle: "small",
      spinnerColor: "#FFFFFF",
    },
    StatusBar: {
      // Do NOT overlay. The theme's safe-area helpers handle the notch for *content*, but the
      // sticky BrokerTopBar is positioned from the viewport top -- with an overlaying status
      // bar its title would sit under the clock.
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#1E4E9C",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },

  android: {
    // Ship the WebView's own error page rather than a blank screen when the site is
    // unreachable -- which, for a live-URL app on Indian mobile data, is a routine state and
    // not an exception.
    webContentsDebuggingEnabled: false,
  },
}

export default config

// ---------------------------------------------------------------------------
// DELIBERATELY ABSENT: server.allowNavigation
// ---------------------------------------------------------------------------
// Capacitor's Android WebViewClient opens any URL *not* matching the server host or
// allowNavigation externally, via an Intent. That default is exactly what this app needs, and
// adding hosts here would break it:
//
//   * wa.me      -- PLAN.md section 6 Option A is the entire messaging strategy. The link must
//                   hand off to the installed WhatsApp app. Listing wa.me here would instead
//                   load WhatsApp Web *inside* our WebView, logged out, which is useless.
//   * tel: / mailto: -- handled as Intents by the same mechanism (dialler, mail app).
//   * *.supabase.co  -- signed document URLs (Phase 4) should open in the system browser so
//                   the download lands in the device's Downloads folder.
//
// So the correct value of allowNavigation is nothing at all. Written down because "we forgot
// to add it" and "we deliberately left it empty" look identical in a diff.
