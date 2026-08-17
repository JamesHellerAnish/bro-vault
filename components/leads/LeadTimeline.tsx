"use client"

// The Timeline tab from PLAN.md section 5: every call / WhatsApp / email / note in reverse
// chronological order, with who did it. Status changes and reassignments appear here too --
// they are written by database triggers, so the timeline is complete whether or not the UI
// remembered to log something.

import { useState } from "react"
import {
  ArrowRightLeft,
  CheckCircle2,
  CircleDot,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Users,
} from "lucide-react"
import type { ActivityType, ActivityWithActor } from "@/lib/supabase/types"
import { ACTIVITY_LABEL } from "@/lib/status"
import { initials, relativeTime } from "@/lib/format"

const ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  status_change: CircleDot,
  assignment: ArrowRightLeft,
  document: FileText,
}

export function LeadTimeline({
  activities,
  isLoading,
  onConfirmSent,
  canEdit,
}: {
  activities: ActivityWithActor[]
  isLoading: boolean
  onConfirmSent: (activityId: string, sent: boolean) => void
  canEdit: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="p-skeleton h-8 w-8 rounded-full" />
            <div className="flex-1">
              <div className="p-skeleton h-3.5 w-1/3" />
              <div className="p-skeleton mt-2 h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="p-empty">
        <p className="text-[14px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
          Nothing logged yet
        </p>
        <p className="mt-1 text-[13px]">Calls, messages and notes will appear here.</p>
      </div>
    )
  }

  return (
    <ol className="px-4 py-4">
      {activities.map((a, i) => {
        const Icon = ICONS[a.type]
        const isSystem = a.type === "status_change" || a.type === "assignment"
        const last = i === activities.length - 1

        return (
          <li key={a.id} className="relative flex gap-3 pb-5">
            {!last && (
              <span
                className="absolute left-[15px] top-9 bottom-0 w-px"
                style={{ background: "var(--p-border)" }}
              />
            )}
            <div
              className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{
                background: isSystem ? "#F3F4F6" : "var(--p-brand-light)",
                color: isSystem ? "var(--p-text-tertiary)" : "var(--p-brand)",
              }}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13.5px] font-semibold" style={{ color: "var(--p-text)" }}>
                  {ACTIVITY_LABEL[a.type]}
                  {a.direction === "in" && " (incoming)"}
                </span>
                <span className="text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
                  {relativeTime(a.occurred_at)}
                </span>
              </div>

              {a.body && (
                <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "var(--p-text-secondary)" }}>
                  {a.body}
                </p>
              )}
              {a.outcome && (
                <p className="mt-1 text-[12.5px] font-medium" style={{ color: "var(--p-green)" }}>
                  {a.outcome}
                </p>
              )}

              {/* The Option A honesty prompt. Only shown to someone who may write. */}
              {a.is_optimistic && !a.outcome && canEdit && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[12px]" style={{ color: "var(--p-amber)" }}>
                    Did this send?
                  </span>
                  <button
                    className="p-chip !px-3 !py-1 !text-[12px]"
                    onClick={() => onConfirmSent(a.id, true)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                  </button>
                  <button
                    className="p-chip !px-3 !py-1 !text-[12px]"
                    onClick={() => onConfirmSent(a.id, false)}
                  >
                    No
                  </button>
                </div>
              )}

              {a.actor && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ background: "#F1F5F9", color: "#64748B" }}
                  >
                    {initials(a.actor.full_name)}
                  </span>
                  <span className="text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
                    {a.actor.full_name}
                  </span>
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function NoteComposer({ onSubmit, disabled }: { onSubmit: (body: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("")
  return (
    <div className="border-t px-4 py-3" style={{ borderColor: "var(--p-border)" }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        disabled={disabled}
        placeholder={disabled ? "You can view this lead but not edit it" : "Add a note…"}
        className="w-full rounded-[14px] border-[1.5px] p-3 text-[14px] outline-none disabled:opacity-60"
        style={{ borderColor: "var(--p-border)", color: "var(--p-text)" }}
      />
      <button
        className="p-btn p-btn-primary mt-2 w-full"
        disabled={disabled || !value.trim()}
        onClick={() => {
          onSubmit(value.trim())
          setValue("")
        }}
      >
        Save note
      </button>
    </div>
  )
}
