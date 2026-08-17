"use client"

// components/leads/WhatsAppComposer.tsx
//
// PLAN.md section 6, Option A -- the one we ship now. We open WhatsApp on the broker's own
// phone with a template already typed; the broker taps send. Zero cost, zero infrastructure,
// zero ban risk, and the client receives it from a real person's number.
//
// The honest limitation, handled here rather than hidden: we cannot observe the send. So
// the activity is logged with is_optimistic = true, and when the broker comes back to the
// app they get a one-tap "did it go?" prompt (see the outcome buttons in LeadTimeline).
// Rendering an optimistic entry identically to a confirmed one would quietly turn "I opened
// WhatsApp" into "the client was messaged", which is exactly the sort of number a
// conversion report should not be built on.

import { useMemo, useState } from "react"
import { ExternalLink, MessageCircle, X } from "lucide-react"
import { useTemplates } from "@/hooks/useOrg"
import { missingVariables, renderTemplate, waNumber } from "@/lib/format"
import type { LeadWithRelations, Profile } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

export function WhatsAppComposer({
  lead,
  me,
  orgName,
  onSent,
  onClose,
}: {
  lead: LeadWithRelations
  me: Profile
  orgName: string
  onSent: (args: { templateId: string | null; body: string }) => void
  onClose: () => void
}) {
  const { data: templates = [], isLoading } = useTemplates("whatsapp")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState("")

  // Merge-field values available for this lead. Anything absent stays visible as
  // {{placeholder}} so the broker sees the gap before sending, not the client after.
  const vars = useMemo<Record<string, string | null>>(
    () => ({
      name: lead.full_name.split(/\s+/)[0] ?? lead.full_name,
      full_name: lead.full_name,
      broker_name: me.full_name,
      org_name: orgName,
      insurance_type: lead.lead_insurance_types?.[0]?.insurance_type?.label ?? null,
      city: lead.city,
      premium: lead.budget_expectation ? String(lead.budget_expectation) : null,
      sum_assured: null,
      pending_documents: null,
      insurer: null,
      policy_number: null,
      renewal_date: null,
      festival: null,
    }),
    [lead, me.full_name, orgName]
  )

  const missing = missingVariables(body, vars)
  const target = lead.whatsapp_number ?? lead.phone
  const href = `https://wa.me/${waNumber(target)}?text=${encodeURIComponent(body)}`

  function pick(id: string, templateBody: string) {
    setSelectedId(id)
    setBody(renderTemplate(templateBody, vars))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div
        className="p-scale-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-white p-5 md:rounded-[24px]"
        role="dialog"
        aria-label="Send WhatsApp message"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="p-section-title">WhatsApp {lead.full_name.split(/\s+/)[0]}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: "var(--p-text-tertiary)" }} />
          </button>
        </div>

        {!lead.whatsapp_opt_in && (
          <p
            className="mb-3 rounded-xl px-3 py-2 text-[12.5px]"
            style={{ background: "var(--p-amber-light)", color: "var(--p-amber)" }}
          >
            This lead has not opted in to WhatsApp. Fine for a reply or a one-to-one message;
            marketing templates need consent first.
          </p>
        )}

        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--p-text-tertiary)" }}>
          Templates
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {isLoading && <div className="p-skeleton h-8 w-28 rounded-full" />}
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id, t.body)}
              className={cn("p-chip", selectedId === t.id && "p-chip-active")}
            >
              {t.name}
              {t.language !== "en" && (
                <span className="ml-1 text-[10px] uppercase opacity-60">{t.language}</span>
              )}
            </button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            setSelectedId(null)
          }}
          rows={6}
          placeholder="Pick a template, or write your own message"
          className="w-full rounded-[14px] border-[1.5px] p-3.5 text-[15px] leading-relaxed outline-none"
          style={{ borderColor: "var(--p-border)", color: "var(--p-text)" }}
        />

        {missing.length > 0 && (
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--p-amber)" }}>
            Still to fill in: {missing.map((v) => `{{${v}}}`).join(", ")}
          </p>
        )}

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (!body.trim()) return
            onSent({ templateId: selectedId, body })
            onClose()
          }}
          className={cn(
            "p-btn mt-4 w-full",
            body.trim() && missing.length === 0 ? "p-btn-success" : "p-btn-outline"
          )}
          aria-disabled={!body.trim()}
        >
          <MessageCircle className="h-[18px] w-[18px]" />
          Open WhatsApp
          <ExternalLink className="h-4 w-4 opacity-70" />
        </a>

        <p className="mt-3 text-center text-[11.5px] leading-relaxed" style={{ color: "var(--p-text-tertiary)" }}>
          WhatsApp opens with this message ready. You still have to press send there — we log
          it as unconfirmed until you tell us it went.
        </p>
      </div>
    </div>
  )
}
