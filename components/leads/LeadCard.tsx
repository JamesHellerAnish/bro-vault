"use client"

import Link from "next/link"
import { Lock, Phone } from "lucide-react"
import type { LeadWithRelations } from "@/lib/supabase/types"
import { STATUS_BADGE_CLASS, STATUS_LABEL, TEMPERATURE_CLASS, TEMPERATURE_LABEL, traitClass } from "@/lib/status"
import { initials, prettyPhone, relativeDue, relativeTime } from "@/lib/format"

// One row of the leads list. PLAN.md section 4: "the assigned broker's name and photo sit
// at the top of every lead card, so accountability stays visible" -- so the assignee is
// always rendered, not only in open mode. In closed mode it is always you, which is a
// harmless redundancy; in open mode it is the whole point.

export function LeadCard({
  lead,
  myProfileId,
}: {
  lead: LeadWithRelations
  myProfileId: string | null
}) {
  const mine = lead.assigned_to === myProfileId
  const due = relativeDue(lead.next_follow_up_at)
  const traits = lead.lead_traits?.map((t) => t.trait).filter(Boolean) ?? []

  return (
    <Link href={`/leads/${lead.id}`} className="p-card p-card-interactive block">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold" style={{ color: "var(--p-text)" }}>
                {lead.full_name}
              </h3>
              {lead.is_private && (
                <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--p-text-tertiary)" }} />
              )}
            </div>
            <div className="mt-1 flex items-center gap-2.5">
              <span className={TEMPERATURE_CLASS[lead.temperature]}>
                {TEMPERATURE_LABEL[lead.temperature]}
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
                {prettyPhone(lead.phone)}
              </span>
            </div>
          </div>
          <span className={STATUS_BADGE_CLASS[lead.status]}>{STATUS_LABEL[lead.status]}</span>
        </div>

        {traits.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {traits.slice(0, 3).map((t) => (
              <span key={t.id} className={traitClass(t.color)}>
                {t.label}
              </span>
            ))}
            {traits.length > 3 && (
              <span className="p-trait p-trait-slate">+{traits.length - 3}</span>
            )}
          </div>
        )}

        <div
          className="mt-3 flex items-center justify-between gap-3 border-t pt-3"
          style={{ borderColor: "var(--p-border-subtle)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              style={{
                background: mine ? "var(--p-brand-light)" : "#F1F5F9",
                color: mine ? "var(--p-brand-dark)" : "#64748B",
              }}
            >
              {initials(lead.assignee?.full_name)}
            </div>
            <span className="truncate text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
              {mine ? "You" : lead.assignee?.full_name ?? "Unassigned"}
              {lead.source?.label ? ` · ${lead.source.label}` : ""}
            </span>
          </div>

          <span
            className="shrink-0 text-[12px] font-medium"
            style={{ color: due.overdue ? "#DC2626" : "var(--p-text-tertiary)" }}
          >
            {lead.next_follow_up_at ? due.label : relativeTime(lead.created_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}

export function LeadCardSkeleton() {
  return (
    <div className="p-card p-4">
      <div className="p-skeleton h-4 w-2/5" />
      <div className="p-skeleton mt-2.5 h-3 w-1/3" />
      <div className="mt-3.5 flex gap-1.5">
        <div className="p-skeleton h-5 w-20 rounded-full" />
        <div className="p-skeleton h-5 w-24 rounded-full" />
      </div>
      <div className="p-skeleton mt-3.5 h-3 w-1/2" />
    </div>
  )
}
