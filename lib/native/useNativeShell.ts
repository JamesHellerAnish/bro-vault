"use client"

// lib/native/useNativeShell.ts
//
// Everything that only means something inside the Capacitor WebView. On the web every branch
// below short-circuits on `Capacitor.isNativePlatform()`, so the same build serves both --
// which is the whole point of live-URL mode (PLAN.md section 13): one deployment, two shells.
//
// ---------------------------------------------------------------------------
// THE PLUGIN-PROXY GOTCHA, INHERITED
// ---------------------------------------------------------------------------
// fe-gmq's docs/vendor-app-capacitor.md records a runtime failure worth carrying over
// verbatim, because it is invisible until it bites: Capacitor's web plugins are Proxy
// objects that intercept *every* property read as a plugin method call -- including `.then`.
// So if you `await import(...)` a plugin and let that Proxy travel out through another
// Promise's resolution, the engine's thenable-check reads `.then`, the Proxy treats it as a
// call to a plugin method named `then`, and it throws
// `CapacitorException: "Preferences.then()" is not implemented on web`.
//
// The rule that avoids it: keep `await import('@capacitor/...')` INLINE in the function that
// uses the plugin. Never factor it into a shared `getPlugin()` helper that returns the plugin
// through its own await boundary. Every dynamic import below is inlined for this reason, and
// it should stay that way even though it looks repetitive.
// ---------------------------------------------------------------------------

import { useEffect } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth/useAuth"

/** True inside the Android/iOS WebView, false in a browser. Safe to call during render. */
export function useIsNative(): boolean {
  if (typeof window === "undefined") return false
  // Capacitor injects this global; importing the package just to read it would pull the
  // plugin machinery into the web bundle for a boolean.
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return Boolean(cap?.isNativePlatform?.())
}

/**
 * Native chrome setup + push registration. Mounted once, from the authenticated layout, so
 * push registration happens only for a signed-in broker with a profile -- registering a
 * device token before we know who is holding the device would attach it to nobody.
 */
export function useNativeShell(): void {
  const { profile } = useAuth()

  // Status bar + splash. Runs once on mount inside the WebView.
  useEffect(() => {
    if (typeof window === "undefined") return
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (!cap?.isNativePlatform?.()) return

    let cancelled = false

    void (async () => {
      // Inlined import -- see the header.
      const { StatusBar, Style } = await import("@capacitor/status-bar")
      if (cancelled) return
      try {
        await StatusBar.setStyle({ style: Style.Light })
        await StatusBar.setBackgroundColor({ color: "#1E4E9C" })
      } catch {
        // setBackgroundColor is Android-only and throws on iOS. Non-fatal: the app is
        // perfectly usable with the platform default bar.
      }
    })()

    void (async () => {
      const { SplashScreen } = await import("@capacitor/splash-screen")
      if (cancelled) return
      // The web app draws BrokerSplash while the auth check runs, so hiding the native splash
      // as soon as React has mounted avoids showing two splash screens back to back.
      try {
        await SplashScreen.hide()
      } catch {
        /* already hidden */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Push registration, gated on having a profile.
  useEffect(() => {
    if (typeof window === "undefined" || !profile) return
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (!cap?.isNativePlatform?.()) return

    let cancelled = false
    const listeners: { remove: () => Promise<void> | void }[] = []

    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications")
      if (cancelled) return

      // Android 13+ requires POST_NOTIFICATIONS at runtime; below that this resolves granted
      // immediately. Asking on every mount is fine -- the OS only prompts once.
      const permission = await PushNotifications.requestPermissions()
      if (permission.receive !== "granted" || cancelled) return

      listeners.push(
        await PushNotifications.addListener("registration", async (token) => {
          const supabase = getSupabaseBrowserClient()
          // register_device_token reassigns the token away from any previous holder --
          // see ...001400_device_tokens.sql for why that matters on a re-issued handset.
          const { error } = await supabase.rpc("register_device_token", {
            p_token: token.value,
            p_platform: "android",
          })
          if (error) {
            // Not surfaced to the broker: a failed push registration is not something they
            // can act on mid-workflow, and the app is fully usable without it.
            console.warn("Push registration failed:", error.message)
          }
        })
      )

      listeners.push(
        await PushNotifications.addListener("registrationError", (err) => {
          // The overwhelmingly common cause is a missing or mismatched google-services.json.
          console.warn("Push registration error:", JSON.stringify(err))
        })
      )

      listeners.push(
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          // Deep-link into the lead the notification is about. The payload shape is set by
          // the sending Edge Function, which does not exist yet -- so this reads defensively
          // rather than assuming a field is present.
          const leadId = action.notification?.data?.lead_id
          if (typeof leadId === "string" && /^[0-9a-f-]{36}$/i.test(leadId)) {
            window.location.assign(`/leads/${leadId}`)
          }
        })
      )

      await PushNotifications.register()
    })()

    return () => {
      cancelled = true
      listeners.forEach((l) => void l.remove())
    }
  }, [profile])
}
