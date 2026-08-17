"use client"

// components/team/ReassignSheet.tsx
//
// One "pick a broker" sheet, used from two places: the ⇄ control on a lead's detail screen
// (PLAN.md section 5's wireframe: "Assigned: Ankit  (Admin: ⇄)") and the bulk reassignment
// queue on a broker's team page (PLAN.md section 1: deactivating someone "pushes their open
// leads to a reassignment queue"). Both are the same action -- pick a new owner for N leads
// -- so it is one component rather than two near-identical modals.
//
// Only active brokers are offered as a target. Reassigning *to* a deactivated broker would
// hand a lead to someone who can no longer see it.

import { useState } from "react"
import { X } from "lucide-react"
import { useBrokers } from "@/hooks/useOrg"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export function ReassignSheet({
  title,
  excludeBrokerId,
  onPick,
  onClose,
  pending,
}: {
  title: string
  /** The current owner, so they don't appear as a target for "reassign away from them". */
  excludeBrokerId?: string
  onPick: (brokerId: string) => void
  onClose: () => void
  pending: boolean
}) {
  const { data: brokers = [], isLoading } = useBrokers()
  const [selected, setSelected] = useState<string | null>(null)
  const options = brokers.filter((b) => b.id !== excludeBrokerId)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div
        className="p-scale-in max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-[24px] bg-white p-5 md:rounded-[24px]"
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="p-section-title">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: "var(--p-text-tertiary)" }} />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-skeleton h-14 w-full rounded-2xl" />
            ))}
          </div>
        )}

        {!isLoading && options.length === 0 && (
          <p className="py-6 text-center text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
            No other active broker to reassign to.
          </p>
        )}

        <div className="space-y-1.5">
          {options.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors",
                selected === b.id ? "" : "hover:bg-gray-50"
              )}
              style={selected === b.id ? { background: "var(--p-brand-light)" } : undefined}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                style={{ background: "white", color: "var(--p-brand-dark)" }}
              >
                {initials(b.full_name)}
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                  {b.full_name}
                </p>
                <p className="text-[11.5px] capitalize" style={{ color: "var(--p-text-tertiary)" }}>
                  {b.role}
                </p>
              </span>
            </button>
          ))}
        </div>

        <button
          className="p-btn p-btn-primary mt-4 w-full"
          disabled={!selected || pending}
          onClick={() => selected && onPick(selected)}
        >
          {pending ? "Reassigning…" : "Reassign"}
        </button>
      </div>
    </div>
  )
}
