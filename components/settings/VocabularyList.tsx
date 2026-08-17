"use client"

// components/settings/VocabularyList.tsx
//
// Shared shape between lead_sources and insurance_types: key/label/sort_order/is_active,
// nothing else. Traits get their own panel (TraitsPanel) because they carry two extra
// fields (category, color) that would turn this component into a pile of optional props --
// two genuinely different shapes are clearer as two small components than one generic one
// bent to fit both.

import { useState } from "react"
import { Plus } from "lucide-react"
import { slugify } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface VocabularyItem {
  id: string
  label: string
  is_active: boolean
}

export function VocabularyList({
  items,
  isLoading,
  onCreate,
  onSetActive,
  creating,
  placeholder,
}: {
  items: VocabularyItem[]
  isLoading: boolean
  onCreate: (input: { key: string; label: string }) => void
  onSetActive: (id: string, isActive: boolean) => void
  creating: boolean
  placeholder: string
}) {
  const [draft, setDraft] = useState("")

  function submit() {
    const label = draft.trim()
    if (!label) return
    onCreate({ key: slugify(label), label })
    setDraft("")
  }

  const active = items.filter((i) => i.is_active)
  const inactive = items.filter((i) => !i.is_active)

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="h-11 flex-1 rounded-[14px] border-[1.5px] px-3.5 text-[14px] outline-none"
          style={{ borderColor: "var(--p-border)" }}
        />
        <button
          className="p-btn p-btn-primary !min-h-[44px] !px-4"
          disabled={!draft.trim() || creating}
          onClick={submit}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-skeleton h-11 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y" style={{ borderColor: "var(--p-border-subtle)" }}>
            {active.map((item) => (
              <Row key={item.id} item={item} onSetActive={onSetActive} />
            ))}
          </ul>

          {inactive.length > 0 && (
            <details className="mt-3">
              <summary
                className="cursor-pointer text-[12.5px] font-medium"
                style={{ color: "var(--p-text-tertiary)" }}
              >
                {inactive.length} deactivated
              </summary>
              <ul className="mt-2 divide-y" style={{ borderColor: "var(--p-border-subtle)" }}>
                {inactive.map((item) => (
                  <Row key={item.id} item={item} onSetActive={onSetActive} />
                ))}
              </ul>
            </details>
          )}

          {items.length === 0 && (
            <p className="mt-3 text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
              Nothing here yet.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  item,
  onSetActive,
}: {
  item: VocabularyItem
  onSetActive: (id: string, isActive: boolean) => void
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span
        className={cn("truncate text-[14px]")}
        style={{ color: item.is_active ? "var(--p-text)" : "var(--p-text-tertiary)" }}
      >
        {item.label}
      </span>
      <button
        className="shrink-0 text-[12px] font-medium"
        style={{ color: item.is_active ? "var(--p-text-tertiary)" : "var(--p-brand)" }}
        onClick={() => onSetActive(item.id, !item.is_active)}
      >
        {item.is_active ? "Deactivate" : "Reactivate"}
      </button>
    </li>
  )
}
