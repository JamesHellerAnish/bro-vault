"use client"

// The daily to-do list from PLAN.md section 8: Today / Overdue / Upcoming as an agenda.
// This is the screen a broker opens first in the morning, so it is deliberately plain --
// a list of names to call, ordered by when they were promised.

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { LeadCard, LeadCardSkeleton } from "@/components/leads/LeadCard"
import { useLeadsInfinite } from "@/hooks/useLeads"
import { useAuth } from "@/lib/auth/useAuth"
import { isOpenStatus } from "@/lib/status"
import { cn } from "@/lib/utils"

type Tab = "today" | "overdue" | "upcoming"

export default function FollowUpsPage() {
  const { profile } = useAuth()
  const params = useSearchParams()
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "today")

  // Follow-ups are always personal, even in open mode: this is your list, not the org's.
  const { data, isLoading } = useLeadsInfinite({
    scope: "mine",
    myProfileId: profile?.id ?? null,
  })

  const leads = useMemo(() => data?.pages.flat() ?? [], [data])

  const buckets = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000)

    const withFollowUp = leads.filter((l) => l.next_follow_up_at && isOpenStatus(l.status))
    const at = (iso: string) => new Date(iso).getTime()

    return {
      overdue: withFollowUp
        .filter((l) => at(l.next_follow_up_at!) < startOfToday.getTime())
        .sort((a, b) => at(a.next_follow_up_at!) - at(b.next_follow_up_at!)),
      today: withFollowUp
        .filter(
          (l) =>
            at(l.next_follow_up_at!) >= startOfToday.getTime() &&
            at(l.next_follow_up_at!) < startOfTomorrow.getTime()
        )
        .sort((a, b) => at(a.next_follow_up_at!) - at(b.next_follow_up_at!)),
      upcoming: withFollowUp
        .filter((l) => at(l.next_follow_up_at!) >= startOfTomorrow.getTime())
        .sort((a, b) => at(a.next_follow_up_at!) - at(b.next_follow_up_at!)),
    }
  }, [leads])

  const visible = buckets[tab]

  return (
    <>
      <BrokerTopBar title="Follow-ups" />
      <div className="px-4 pt-3">
        <div className="p-tabs">
          {(["today", "overdue", "upcoming"] as Tab[]).map((t) => (
            <button key={t} className={cn("p-tab", tab === t && "p-tab-active")} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
              {buckets[t].length > 0 && (
                <span className="ml-1.5 text-[11px] opacity-70">{buckets[t].length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <LeadCardSkeleton key={i} />)}

        {!isLoading && visible.length === 0 && (
          <div className="p-empty">
            <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
              {tab === "overdue" ? "Nothing overdue" : tab === "today" ? "Nothing due today" : "Nothing scheduled"}
            </p>
            <p className="mt-1 max-w-xs text-[13px]">
              {tab === "overdue"
                ? "You are on top of your list."
                : "Set a follow-up date on a lead and it will show up here."}
            </p>
          </div>
        )}

        {visible.map((lead) => (
          <LeadCard key={lead.id} lead={lead} myProfileId={profile?.id ?? null} />
        ))}
      </div>
    </>
  )
}
