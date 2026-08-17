"use client"

// Quick-add. PLAN.md section 8 lists "Add lead" and "Quick-add (name + phone only)" as two
// entries; this is one form that behaves as both -- everything past name and phone is
// optional and collapsed behind "More details".
//
// The reason for that shape: a broker adds a lead standing in front of the person, on a
// phone, often mid-conversation. A twelve-field form gets abandoned; a two-field one gets
// filled and enriched later from the detail screen.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { useCreateLead } from "@/hooks/useLeads"
import { useInsuranceTypes, useLeadSources } from "@/hooks/useOrg"
import { useAuth } from "@/lib/auth/useAuth"
import type { LeadTemperature } from "@/lib/supabase/types"
import { TEMPERATURE_LABEL } from "@/lib/status"
import { cn } from "@/lib/utils"

export default function NewLeadPage() {
  const router = useRouter()
  const { profile } = useAuth()
  const createLead = useCreateLead()
  const { data: sources = [] } = useLeadSources()
  const { data: insuranceTypes = [] } = useInsuranceTypes()

  const [fullName, setFullName] = useState("")
  const [digits, setDigits] = useState("")
  const [temperature, setTemperature] = useState<LeadTemperature>("warm")
  const [sourceId, setSourceId] = useState<string>("")
  const [city, setCity] = useState("")
  const [age, setAge] = useState("")
  const [description, setDescription] = useState("")
  const [consent, setConsent] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const phoneValid = /^[6-9]\d{9}$/.test(digits)
  const canSubmit = fullName.trim().length > 1 && phoneValid && !createLead.isPending

  async function submit() {
    if (!profile) return
    try {
      const lead = await createLead.mutateAsync({
        full_name: fullName.trim(),
        phone: `+91${digits}`,
        whatsapp_number: `+91${digits}`,
        temperature,
        source_id: sourceId || null,
        city: city.trim() || null,
        age: age ? Number(age) : null,
        description: description.trim() || null,
        // DPDP Act 2023 (PLAN.md section 11): consent is recorded at intake or not at all.
        // The database enforces that consent_at accompanies consent_given.
        consent_given: consent,
        consent_at: consent ? new Date().toISOString() : null,
        whatsapp_opt_in: consent,
        // A broker may only create leads assigned to themselves -- the RLS insert policy
        // enforces it, so sending anything else here would simply be refused.
        assigned_to: profile.id,
        created_by: profile.id,
      })
      toast.success("Lead added")
      router.replace(`/leads/${lead.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <BrokerTopBar title="Add lead" back />
      <div className="space-y-4 px-4 py-5 pb-24">
        <Field label="Full name" required>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
            placeholder="Ramesh Sharma"
            className="h-[52px] w-full rounded-[14px] border-[1.5px] px-4 text-[15px] outline-none"
            style={{ borderColor: "var(--p-border)" }}
          />
        </Field>

        <Field label="Mobile number" required>
          <div
            className="flex items-center gap-2 rounded-[14px] border-[1.5px] px-4"
            style={{ borderColor: "var(--p-border)" }}
          >
            <span className="text-[15px]" style={{ color: "var(--p-text-tertiary)" }}>
              +91
            </span>
            <input
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="98765 43210"
              className="h-[52px] flex-1 bg-transparent text-[15px] outline-none"
            />
          </div>
        </Field>

        <Field label="Interest">
          <div className="flex gap-2">
            {(["hot", "warm", "cold"] as LeadTemperature[]).map((t) => (
              <button
                key={t}
                className={cn("p-chip flex-1 justify-center", temperature === t && "p-chip-active")}
                onClick={() => setTemperature(t)}
              >
                {TEMPERATURE_LABEL[t]}
              </button>
            ))}
          </div>
        </Field>

        <button
          className="flex w-full items-center justify-between py-2 text-[14px] font-medium"
          style={{ color: "var(--p-brand)" }}
          onClick={() => setExpanded((v) => !v)}
        >
          More details
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>

        {expanded && (
          <div className="p-fade space-y-4">
            <Field label="Source">
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="h-[52px] w-full rounded-[14px] border-[1.5px] bg-white px-4 text-[15px] outline-none"
                style={{ borderColor: "var(--p-border)" }}
              >
                <option value="">Not specified</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="h-[52px] w-full rounded-[14px] border-[1.5px] px-4 text-[15px] outline-none"
                  style={{ borderColor: "var(--p-border)" }}
                />
              </Field>
              <Field label="Age">
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  className="h-[52px] w-full rounded-[14px] border-[1.5px] px-4 text-[15px] outline-none"
                  style={{ borderColor: "var(--p-border)" }}
                />
              </Field>
            </div>

            <Field label="What do they need?">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Family of 4, wants 10L floater, worried about father's diabetes exclusion"
                className="w-full rounded-[14px] border-[1.5px] p-3.5 text-[15px] leading-relaxed outline-none"
                style={{ borderColor: "var(--p-border)" }}
              />
            </Field>

            {insuranceTypes.length > 0 && (
              <p className="text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
                Insurance type and traits can be set on the lead once it is created.
              </p>
            )}
          </div>
        )}

        <label className="flex items-start gap-3 rounded-[14px] p-3.5" style={{ background: "#F9FAFB" }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-[13px] leading-relaxed" style={{ color: "var(--p-text-secondary)" }}>
            They agreed to be contacted about insurance, including on WhatsApp. Recording this
            is required before any marketing message (DPDP Act 2023).
          </span>
        </label>

        <button className="p-btn p-btn-primary w-full" disabled={!canSubmit} onClick={() => void submit()}>
          {createLead.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add lead"}
        </button>
      </div>
    </>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
        {label}
        {required && <span style={{ color: "var(--p-brand)" }}> *</span>}
      </span>
      {children}
    </label>
  )
}
