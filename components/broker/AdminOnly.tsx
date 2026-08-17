"use client"

// components/broker/AdminOnly.tsx
//
// Guards the /team and /settings routes. This is presentation only, in the same sense as
// `canEdit` on the lead detail screen: the nav already hides these links from a broker, but
// the route itself is still reachable by URL, and without this a non-admin would land on a
// page that fires admin-only RPCs and renders a wall of "insufficient privilege" toasts.
//
// It is not the security boundary. Every table and RPC these screens touch is already
// gated by RLS (profiles_insert_admin, org_settings_update_admin, app_private.require_admin
// inside broker_leaderboard, and so on) -- if this component were deleted entirely, a
// broker who typed /settings in the address bar would see empty lists and failed writes,
// never someone else's data.

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { ShieldAlert } from "lucide-react"
import { useAuth } from "@/lib/auth/useAuth"
import { BrokerSplash } from "@/components/broker/BrokerSplash"

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, initialCheckComplete } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (initialCheckComplete && profile && !isAdmin) {
      router.replace("/dashboard")
    }
  }, [initialCheckComplete, profile, isAdmin, router])

  if (!initialCheckComplete || !profile) return <BrokerSplash />

  if (!isAdmin) {
    // Shown for the one render before the redirect above takes effect, and as a fallback
    // if navigation is somehow blocked.
    return (
      <div className="p-empty">
        <ShieldAlert className="mb-3 h-8 w-8" />
        <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
          Admin only
        </p>
        <p className="mt-1 max-w-xs text-[13px]">Taking you back to your dashboard…</p>
      </div>
    )
  }

  return <>{children}</>
}
