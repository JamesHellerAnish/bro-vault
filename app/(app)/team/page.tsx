"use client"

// PLAN.md section 8: "Broker list, invite broker, per-broker stats, reassign leads".
// Per-broker stats and reassignment live on the [id] detail page; this is the roster.

import { useState } from "react"
import Link from "next/link"
import { Plus, UserX } from "lucide-react"
import { toast } from "sonner"
import { AdminOnly } from "@/components/broker/AdminOnly"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { InviteBrokerSheet } from "@/components/team/InviteBrokerSheet"
import { useAllProfiles, useSetProfileActive } from "@/hooks/useTeam"
import { useAuth } from "@/lib/auth/useAuth"
import { initials, prettyPhone } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function TeamPage() {
  return (
    <AdminOnly>
      <TeamContent />
    </AdminOnly>
  )
}

function TeamContent() {
  const { profile: me } = useAuth()
  const { data: profiles = [], isLoading } = useAllProfiles()
  const setActive = useSetProfileActive()
  const [inviting, setInviting] = useState(false)
  const [tab, setTab] = useState<"active" | "inactive">("active")

  const active = profiles.filter((p) => p.is_active)
  const inactive = profiles.filter((p) => !p.is_active)
  const visible = tab === "active" ? active : inactive

  function toggleActive(id: string, isActive: boolean, name: string) {
    setActive.mutate(
      { id, isActive },
      {
        onSuccess: () =>
          toast.success(isActive ? `${name} reactivated` : `${name} deactivated`),
        onError: (e) => toast.error((e as Error).message),
      }
    )
  }

  return (
    <>
      <BrokerTopBar title="Team" />

      <div className="px-4 pt-3">
        <div className="p-tabs">
          <button className={cn("p-tab", tab === "active" && "p-tab-active")} onClick={() => setTab("active")}>
            Active <span className="ml-1 text-[11px] opacity-70">{active.length}</span>
          </button>
          <button className={cn("p-tab", tab === "inactive" && "p-tab-active")} onClick={() => setTab("inactive")}>
            Deactivated <span className="ml-1 text-[11px] opacity-70">{inactive.length}</span>
          </button>
        </div>
      </div>

      <div className="space-y-2.5 px-4 py-4">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-skeleton h-[72px] w-full rounded-card" />)}

        {!isLoading && visible.length === 0 && (
          <div className="p-empty">
            <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
              {tab === "active" ? "No one here yet" : "No deactivated accounts"}
            </p>
          </div>
        )}

        {visible.map((p) => (
          <div key={p.id} className="p-card flex items-center gap-3 p-4">
            <Link href={`/team/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                style={{
                  background: p.is_active ? "var(--p-brand-light)" : "#F1F5F9",
                  color: p.is_active ? "var(--p-brand-dark)" : "#64748B",
                }}
              >
                {initials(p.full_name)}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <p className="truncate text-[14.5px] font-semibold" style={{ color: "var(--p-text)" }}>
                    {p.full_name}
                  </p>
                  {p.id === me?.id && (
                    <span className="p-trait p-trait-blue !px-2 !py-0.5 !text-[10px]">You</span>
                  )}
                </span>
                <p className="text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
                  {prettyPhone(p.phone)} · <span className="capitalize">{p.role}</span>
                </p>
              </span>
            </Link>

            {p.id !== me?.id && (
              <button
                className={cn("p-chip !px-3 !py-1.5 !text-[12px]", p.is_active && "!border-red-200 !text-red-600")}
                disabled={setActive.isPending}
                onClick={() => toggleActive(p.id, !p.is_active, p.full_name)}
              >
                {p.is_active ? (
                  <>
                    <UserX className="h-3.5 w-3.5" /> Deactivate
                  </>
                ) : (
                  "Reactivate"
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => setInviting(true)}
        className="fixed bottom-[calc(var(--p-nav-h)+1rem)] right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg md:bottom-8"
        style={{ background: "var(--p-brand)", boxShadow: "0 6px 20px rgba(30,78,156,0.35)" }}
        aria-label="Add team member"
      >
        <Plus className="h-6 w-6" strokeWidth={2.4} />
      </button>

      {inviting && <InviteBrokerSheet onClose={() => setInviting(false)} />}
    </>
  )
}
