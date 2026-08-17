"use client"

import { BrokerAuthGate } from "@/components/broker/BrokerAuthGate"
import { BrokerAppShell } from "@/components/broker/BrokerAppShell"
import { useNativeShell } from "@/lib/native/useNativeShell"

// Everything under (app) is behind the gate and inside the shell. The route group keeps the
// URLs clean (/dashboard, not /app/dashboard) while giving every authenticated screen the
// same chrome in one place.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // No-ops entirely in a browser; inside the Capacitor WebView it sets the status bar, hides
  // the native splash and registers for push. Mounted here rather than in the root layout
  // because push registration needs a signed-in profile, which only exists inside the gate --
  // and the hook itself reads useAuth(), so it must sit under the AuthProvider anyway.
  return (
    <BrokerAuthGate>
      <NativeShellBridge />
      <BrokerAppShell>{children}</BrokerAppShell>
    </BrokerAuthGate>
  )
}

/**
 * Separate component purely so the hook runs *inside* BrokerAuthGate. Calling it in AppLayout
 * itself would run it while the gate is still showing the splash or the login screen, before
 * there is any profile to attach a device token to.
 */
function NativeShellBridge() {
  useNativeShell()
  return null
}
