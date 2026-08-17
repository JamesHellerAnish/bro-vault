"use client"

import { usePathname } from "next/navigation"
import { BrokerSidebar } from "@/components/broker/BrokerSidebar"
import { BrokerBottomNav } from "@/components/broker/BrokerBottomNav"
import { cn } from "@/lib/utils"

// Ported from fe-gmq's PartnerAppShell, including the rule that makes it feel like an app
// rather than a website: focused detail routes hide the bottom nav, while the list routes
// above them keep it so the tab stays reachable and highlighted.
//
// On desktop the same routes render in a sidebar layout (PLAN.md section 8) -- the nav
// swaps, the routing does not.
export function BrokerAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideNav =
    /^\/leads\/.+/.test(pathname) ||
    /^\/team\/.+/.test(pathname) ||
    pathname.startsWith("/notifications") ||
    // /settings has no bottom-nav tab of its own (five icons is already the ceiling for a
    // thumb-reachable bar) -- showing the nav here would just render one with nothing
    // highlighted, which reads as broken rather than as "you're somewhere else".
    pathname.startsWith("/settings")

  return (
    <div className="p-screen flex">
      <BrokerSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className={cn("flex-1", !hideNav && "pb-[calc(var(--p-nav-h)+0.5rem)] md:pb-0")}>
          {children}
        </main>
      </div>
      {!hideNav && <BrokerBottomNav />}
    </div>
  )
}
