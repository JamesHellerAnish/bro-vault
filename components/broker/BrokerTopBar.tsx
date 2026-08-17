"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, Bell } from "lucide-react"
import Link from "next/link"
import { useUnreadCount } from "@/hooks/useNotifications"

// Sticky blurred top bar, ported from fe-gmq's PartnerTopBar. `back` turns it into a
// detail-screen header -- the same component, so the height never disagrees between screens
// and the sticky action bar underneath (--p-topbar-h) always lines up.
export function BrokerTopBar({ title, back = false }: { title: string; back?: boolean }) {
  const router = useRouter()
  const unread = useUnreadCount()

  return (
    <header
      className="p-safe-top sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ borderColor: "var(--p-border)", background: "rgba(255,255,255,0.85)" }}
    >
      <div className="flex h-[var(--p-topbar-h)] items-center gap-2 px-4">
        {back && (
          <button
            onClick={() => router.back()}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" style={{ color: "var(--p-text)" }} />
          </button>
        )}
        <h1 className="flex-1 truncate text-[17px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
          {title}
        </h1>
        <Link
          href="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full"
          aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        >
          <Bell className="h-[19px] w-[19px]" style={{ color: "var(--p-text-secondary)" }} strokeWidth={1.8} />
          {unread > 0 && (
            <span
              className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
              style={{ background: "var(--p-brand)" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
      </div>
    </header>
  )
}
