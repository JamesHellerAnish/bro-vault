"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, CalendarClock, UserCog, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth/useAuth"

// Ported from fe-gmq's PartnerBottomNav (PLAN.md section 13). The Team tab is admin-only,
// so the grid is 4 or 5 columns depending on role -- hence the inline gridTemplateColumns
// rather than a fixed grid-cols-5 class.
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, adminOnly: false },
  { key: "leads", label: "Leads", href: "/leads", icon: Users, adminOnly: false },
  { key: "followups", label: "Follow-ups", href: "/follow-ups", icon: CalendarClock, adminOnly: false },
  { key: "team", label: "Team", href: "/team", icon: UserCog, adminOnly: true },
  { key: "profile", label: "Profile", href: "/profile", icon: User, adminOnly: false },
] as const

export function BrokerBottomNav() {
  const pathname = usePathname()
  const { isAdmin } = useAuth()
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin)

  return (
    <nav
      className="p-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-white md:hidden"
      style={{ borderColor: "var(--p-border)", boxShadow: "var(--p-shadow-nav)" }}
    >
      <div
        className="grid h-[var(--p-nav-h)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ key, label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-all duration-200",
              )}
              style={{ color: active ? "var(--p-brand)" : "var(--p-text-tertiary)" }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-200"
                style={{ background: active ? "var(--p-brand-light)" : "transparent" }}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.6} />
              </div>
              <span className={cn("leading-none", active && "font-semibold")}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
