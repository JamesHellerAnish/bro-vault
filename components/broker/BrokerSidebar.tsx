"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, CalendarClock, UserCog, User, Settings, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth/useAuth"
import { initials } from "@/lib/format"

// Desktop counterpart to the bottom nav. PLAN.md section 8: "identical routes in a two-pane
// layout with a left sidebar instead of bottom tabs" -- same hrefs, different chrome, so
// there is exactly one router and no desktop-only route to keep in sync.
const LINKS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, adminOnly: false },
  { label: "Leads", href: "/leads", icon: Users, adminOnly: false },
  { label: "Follow-ups", href: "/follow-ups", icon: CalendarClock, adminOnly: false },
  { label: "Team", href: "/team", icon: UserCog, adminOnly: true },
  { label: "Settings", href: "/settings", icon: Settings, adminOnly: true },
  { label: "Profile", href: "/profile", icon: User, adminOnly: false },
] as const

export function BrokerSidebar() {
  const pathname = usePathname()
  const { profile, isAdmin } = useAuth()

  return (
    <aside className="p-sidebar hidden md:flex md:flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "var(--p-brand-light)" }}
        >
          <Shield className="h-[18px] w-[18px]" style={{ color: "var(--p-brand)" }} strokeWidth={2.2} />
        </div>
        <span className="text-[15px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
          MyInsuranceBro
        </span>
      </div>

      <nav className="flex-1 py-2">
        {LINKS.filter((l) => !l.adminOnly || isAdmin).map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn("p-sidebar-link", pathname.startsWith(href) && "p-sidebar-link-active")}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3 border-t px-5 py-4" style={{ borderColor: "var(--p-border)" }}>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: "var(--p-brand-light)", color: "var(--p-brand-dark)" }}
        >
          {initials(profile?.full_name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold" style={{ color: "var(--p-text)" }}>
            {profile?.full_name}
          </p>
          <p className="text-[11px] capitalize" style={{ color: "var(--p-text-tertiary)" }}>
            {profile?.role}
          </p>
        </div>
      </div>
    </aside>
  )
}
