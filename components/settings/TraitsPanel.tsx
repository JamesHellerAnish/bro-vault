"use client"

// components/settings/TraitsPanel.tsx
//
// PLAN.md section 3: traits are grouped into three categories (behavioural, situational,
// operational) and PLAN.md section 4's chip colour is decided by category, not by the
// individual trait -- lib/status.ts's traitClass() already encodes that, and TRAIT_COLORS
// is the exact set the theme has CSS for (app/broker-theme.css: .p-trait-slate, -blue, ...).
// The colour picker here is restricted to that set for the same reason: a colour the theme
// has no class for falls back to slate anyway (traitClass), so offering more choices would
// just be a picker with wrong previews.

import { useState } from "react"
import { Plus } from "lucide-react"
import { slugify } from "@/lib/format"
import { TRAIT_COLORS, traitClass } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { Trait, TraitCategory } from "@/lib/supabase/types"

const CATEGORIES: { key: TraitCategory; label: string }[] = [
  { key: "behavioural", label: "Behavioural" },
  { key: "situational", label: "Situational" },
  { key: "operational", label: "Operational" },
]

export function TraitsPanel({
  traits,
  isLoading,
  onCreate,
  onSetActive,
  creating,
}: {
  traits: Trait[]
  isLoading: boolean
  onCreate: (input: { key: string; label: string; category: TraitCategory; color: string }) => void
  onSetActive: (id: string, isActive: boolean) => void
  creating: boolean
}) {
  const [label, setLabel] = useState("")
  const [category, setCategory] = useState<TraitCategory>("behavioural")
  const [color, setColor] = useState<string>("slate")

  function submit() {
    const trimmed = label.trim()
    if (!trimmed) return
    onCreate({ key: slugify(trimmed), label: trimmed, category, color })
    setLabel("")
  }

  return (
    <div>
      <div className="p-card p-3.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="New trait name"
          className="h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
          style={{ borderColor: "var(--p-border)" }}
        />

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={cn("p-chip !px-3 !py-1.5 !text-[12px]", category === c.key && "p-chip-active")}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          {TRAIT_COLORS.map((c) => (
            <button
              key={c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-transform",
                color === c ? "scale-110" : "border-transparent opacity-60"
              )}
              style={{
                borderColor: color === c ? "var(--p-text)" : "transparent",
                background: SWATCH[c],
              }}
            />
          ))}
          <button
            className="p-btn p-btn-primary ml-auto !min-h-[36px] !px-4 !text-[13px]"
            disabled={!label.trim() || creating}
            onClick={submit}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {label.trim() && <span className={cn("mt-2.5 inline-block", traitClass(color))}>{label.trim()}</span>}
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-skeleton h-9 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        CATEGORIES.map((c) => {
          const inCategory = traits.filter((t) => t.category === c.key)
          if (inCategory.length === 0) return null
          return (
            <div key={c.key} className="mt-4">
              <p className="p-stat-label mb-2">{c.label}</p>
              <div className="flex flex-wrap gap-2">
                {inCategory.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onSetActive(t.id, !t.is_active)}
                    className={cn(traitClass(t.color), !t.is_active && "opacity-40")}
                    title={t.is_active ? "Tap to deactivate" : "Tap to reactivate"}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const SWATCH: Record<string, string> = {
  slate: "#94A3B8",
  blue: "#2563EB",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  violet: "#7C3AED",
}
