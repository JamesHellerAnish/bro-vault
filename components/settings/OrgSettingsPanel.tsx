"use client"

// components/settings/OrgSettingsPanel.tsx
//
// The visibility switch is PLAN.md section 4's whole mechanism, rendered: flipping it here
// changes what every broker's leads query returns, because org_settings.lead_visibility is
// read straight into app_private.lead_visibility() inside the RLS policy itself. There is
// no cache to bust and no server to restart -- the next query any broker makes reflects it.
//
// Each field commits independently on blur/change rather than behind one "Save" button.
// A single multi-field form with one submit risks a half-typed business-hours edit
// accidentally going out together with a visibility flip the admin meant to commit alone --
// and visibility is the one setting here where "did that actually save" matters immediately.

import { useState } from "react"
import { toast } from "sonner"
import { useUpdateOrgSettings } from "@/hooks/useAdminOrg"
import type { OrgSettings } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

export function OrgSettingsPanel({ org }: { org: OrgSettings }) {
  const update = useUpdateOrgSettings()
  const [orgName, setOrgName] = useState(org.org_name)
  const [threshold, setThreshold] = useState(String(org.unattended_lead_hours))

  function commit(patch: Partial<OrgSettings>, label: string) {
    update.mutate(patch, {
      onSuccess: () => toast.success(`${label} updated`),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  return (
    <div className="space-y-4">
      <section className="p-card p-4">
        <p className="p-stat-label">Lead visibility</p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--p-text-secondary)" }}>
          {org.lead_visibility === "all"
            ? "Every broker sees every lead. Non-owners get a read-only view."
            : "A broker's list holds only leads assigned to them."}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            className={cn("p-chip flex-1 justify-center", org.lead_visibility === "assigned_only" && "p-chip-active")}
            onClick={() => commit({ lead_visibility: "assigned_only" }, "Visibility")}
          >
            Closed -- assigned only
          </button>
          <button
            className={cn("p-chip flex-1 justify-center", org.lead_visibility === "all" && "p-chip-active")}
            onClick={() => commit({ lead_visibility: "all" }, "Visibility")}
          >
            Open -- everyone
          </button>
        </div>

        {org.lead_visibility === "all" && (
          <label className="mt-4 flex items-start gap-3 rounded-[14px] p-3" style={{ background: "#F9FAFB" }}>
            <input
              type="checkbox"
              checked={org.allow_cross_broker_edit}
              onChange={(e) => commit({ allow_cross_broker_edit: e.target.checked }, "Cross-broker editing")}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-[13px] leading-relaxed" style={{ color: "var(--p-text-secondary)" }}>
              Let a broker edit a colleague's lead, not just view it. Never applies to a lead
              flagged private, regardless of this setting.
            </span>
          </label>
        )}
      </section>

      <section className="p-card p-4">
        <p className="p-stat-label">Unattended-lead alert</p>
        <p className="mt-1 text-[13px]" style={{ color: "var(--p-text-secondary)" }}>
          Flag a lead on the dashboard when it has sat this many hours with no call, message
          or meeting.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={720}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={() => {
              const n = Number(threshold)
              if (Number.isFinite(n) && n >= 1 && n <= 720 && n !== org.unattended_lead_hours) {
                commit({ unattended_lead_hours: n }, "Unattended-lead threshold")
              } else {
                setThreshold(String(org.unattended_lead_hours))
              }
            }}
            className="h-11 w-24 rounded-[12px] border-[1.5px] px-3 text-[14px] outline-none"
            style={{ borderColor: "var(--p-border)" }}
          />
          <span className="text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
            hours
          </span>
        </div>
      </section>

      <section className="p-card p-4">
        <p className="p-stat-label">Organisation name</p>
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          onBlur={() => {
            const trimmed = orgName.trim()
            if (trimmed && trimmed !== org.org_name) commit({ org_name: trimmed }, "Organisation name")
            else setOrgName(org.org_name)
          }}
          className="mt-2 h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
          style={{ borderColor: "var(--p-border)" }}
        />
        <p className="mt-3 text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
          Timezone: {org.timezone} · Business hours {org.business_hours_start}–{org.business_hours_end}
        </p>
      </section>
    </div>
  )
}
