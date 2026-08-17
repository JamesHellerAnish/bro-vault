"use client"

import Link from "next/link"
import { LogOut, Phone, Mail, Shield, Building2, Settings, UserCog, ChevronRight } from "lucide-react"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { useAuth } from "@/lib/auth/useAuth"
import { useOrgSettings } from "@/hooks/useOrg"
import { initials, prettyPhone } from "@/lib/format"

export default function ProfilePage() {
  const { profile, isAdmin, signOut } = useAuth()
  const { data: org } = useOrgSettings()

  if (!profile) return null

  return (
    <>
      <BrokerTopBar title="Profile" />
      <div className="px-4 py-5">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-[20px] font-bold"
            style={{ background: "var(--p-brand-light)", color: "var(--p-brand-dark)" }}
          >
            {initials(profile.full_name)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
              {profile.full_name}
            </h2>
            <p className="text-[13px] capitalize" style={{ color: "var(--p-text-tertiary)" }}>
              {profile.role === "admin" ? "Chief Advisor" : "Broker"}
            </p>
          </div>
        </div>

        <div className="p-card mt-5 p-4">
          <InfoRow icon={Phone} label="Mobile" value={prettyPhone(profile.phone)} />
          {profile.email && <InfoRow icon={Mail} label="Email" value={profile.email} />}
          {org && <InfoRow icon={Building2} label="Organisation" value={org.org_name} />}
          {org && (
            <InfoRow
              icon={Shield}
              label="Lead visibility"
              value={org.lead_visibility === "all" ? "Everyone can view all leads" : "Only your assigned leads"}
            />
          )}
        </div>

        <p className="mt-4 px-1 text-[12px] leading-relaxed" style={{ color: "var(--p-text-tertiary)" }}>
          Your name and photo can be changed here. Your mobile number and role are managed by
          your admin — the database refuses to let anyone change their own.
        </p>

        {isAdmin && (
          <div className="p-card mt-4 divide-y md:hidden" style={{ borderColor: "var(--p-border-subtle)" }}>
            {/* Team already has its own bottom-nav tab on mobile; Settings does not
                (five icons is already the ceiling for a thumb-reachable bar), so this is
                its only mobile entry point. */}
            <Link href="/team" className="flex items-center gap-3 p-3.5">
              <UserCog className="h-[18px] w-[18px]" style={{ color: "var(--p-text-secondary)" }} />
              <span className="flex-1 text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                Team
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--p-text-tertiary)" }} />
            </Link>
            <Link href="/settings" className="flex items-center gap-3 p-3.5">
              <Settings className="h-[18px] w-[18px]" style={{ color: "var(--p-text-secondary)" }} />
              <span className="flex-1 text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                Settings
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--p-text-tertiary)" }} />
            </Link>
          </div>
        )}

        <button className="p-btn p-btn-outline mt-5 w-full" onClick={() => void signOut()}>
          <LogOut className="h-[18px] w-[18px]" />
          Sign out
        </button>
      </div>
    </>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="p-info-icon" style={{ background: "#F3F4F6" }}>
        <Icon className="h-4 w-4" style={{ color: "var(--p-text-secondary)" }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] uppercase tracking-wide" style={{ color: "var(--p-text-tertiary)" }}>
          {label}
        </p>
        <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
          {value}
        </p>
      </div>
    </div>
  )
}
