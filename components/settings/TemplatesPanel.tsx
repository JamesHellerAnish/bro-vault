"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { TemplateEditorSheet } from "@/components/settings/TemplateEditorSheet"
import { useSetTemplateActive } from "@/hooks/useAdminOrg"
import type { Template, TemplateChannel } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

export function TemplatesPanel({ templates, isLoading }: { templates: Template[]; isLoading: boolean }) {
  const setActive = useSetTemplateActive()
  const [channel, setChannel] = useState<TemplateChannel>("whatsapp")
  const [editing, setEditing] = useState<Template | null | "new">(null)

  const visible = templates.filter((t) => t.channel === channel)

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="p-tabs">
          {(["whatsapp", "email"] as TemplateChannel[]).map((c) => (
            <button
              key={c}
              className={cn("p-tab capitalize", channel === c && "p-tab-active")}
              onClick={() => setChannel(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <button className="p-chip !px-3 !py-1.5 !text-[12px]" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-skeleton h-16 w-full rounded-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
          No {channel} templates yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((t) => (
            <li key={t.id} className="p-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(t)}>
                  <span className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>
                      {t.name}
                    </p>
                    {t.language !== "en" && (
                      <span className="p-trait p-trait-slate !px-1.5 !py-0.5 !text-[10px] uppercase">
                        {t.language}
                      </span>
                    )}
                    {!t.is_active && <span className="p-trait p-trait-red !px-1.5 !py-0.5 !text-[10px]">Off</span>}
                  </span>
                  <p className="mt-1 line-clamp-2 text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
                    {t.body}
                  </p>
                </button>
                <button
                  className="shrink-0 text-[12px] font-medium"
                  style={{ color: t.is_active ? "var(--p-text-tertiary)" : "var(--p-brand)" }}
                  onClick={() => setActive.mutate({ id: t.id, isActive: !t.is_active })}
                >
                  {t.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditorSheet
          template={editing === "new" ? null : editing}
          defaultChannel={channel}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
