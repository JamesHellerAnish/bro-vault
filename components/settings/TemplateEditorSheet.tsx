"use client"

// components/settings/TemplateEditorSheet.tsx
//
// PLAN.md section 6: "admin owns the library, brokers stay on-script". This is the only
// place a template's body can change -- WhatsAppComposer (Phase 2) only ever reads
// templates, never writes them, which is the enforcement of that line as much as the RLS
// policy is (templates_write_admin, Phase 1).
//
// Variables are detected from the body/subject text, not typed in separately: a second
// field that has to be kept in sync with the {{...}} markers is a place for the two to
// drift. extractVariables() (lib/format.ts) is the same regex renderTemplate() and
// missingVariables() use in the composer, so what the editor shows as "variables in this
// template" is exactly what the composer will look for.

import { useState } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { useCreateTemplate, useUpdateTemplate, type TemplateInput } from "@/hooks/useAdminOrg"
import { extractVariables } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Template, TemplateChannel } from "@/lib/supabase/types"

export function TemplateEditorSheet({
  template,
  defaultChannel,
  onClose,
}: {
  /** Null for "create new". */
  template: Template | null
  defaultChannel: TemplateChannel
  onClose: () => void
}) {
  const create = useCreateTemplate()
  const update = useUpdateTemplate(template?.id ?? "")
  const pending = create.isPending || update.isPending

  const [channel, setChannel] = useState<TemplateChannel>(template?.channel ?? defaultChannel)
  const [name, setName] = useState(template?.name ?? "")
  const [category, setCategory] = useState(template?.category ?? "")
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [body, setBody] = useState(template?.body ?? "")
  const [language, setLanguage] = useState(template?.language ?? "en")

  const variables = extractVariables(body, channel === "email" ? subject : null)

  // Mirrors templates_email_needs_subject_ck (Phase 1): an email template with no subject
  // is caught here, before the round trip, not just by the constraint after it.
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && (channel !== "email" || subject.trim().length > 0)

  async function submit() {
    const input: TemplateInput = {
      channel,
      name: name.trim(),
      category: category.trim() || null,
      subject: channel === "email" ? subject.trim() : null,
      body: body.trim(),
      variables,
      language,
    }
    try {
      if (template) {
        await update.mutateAsync(input)
        toast.success("Template updated")
      } else {
        await create.mutateAsync(input)
        toast.success("Template added")
      }
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div
        className="p-scale-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-white p-5 md:rounded-[24px]"
        role="dialog"
        aria-label={template ? "Edit template" : "New template"}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="p-section-title">{template ? "Edit template" : "New template"}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: "var(--p-text-tertiary)" }} />
          </button>
        </div>

        <div className="space-y-3.5">
          <div className="flex gap-2">
            {(["whatsapp", "email"] as TemplateChannel[]).map((c) => (
              <button
                key={c}
                className={cn("p-chip flex-1 justify-center capitalize", channel === c && "p-chip-active")}
                onClick={() => setChannel(c)}
                disabled={Boolean(template)}
                title={template ? "Channel can't change after creation" : undefined}
              >
                {c}
              </button>
            ))}
          </div>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Quote follow-up"
              className="h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
              style={{ borderColor: "var(--p-border)" }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="follow_up"
                className="h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
                style={{ borderColor: "var(--p-border)" }}
              />
            </Field>
            <Field label="Language">
              <input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="en"
                className="h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
                style={{ borderColor: "var(--p-border)" }}
              />
            </Field>
          </div>

          {channel === "email" && (
            <Field label="Subject">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Your {{insurance_type}} quote from {{org_name}}"
                className="h-11 w-full rounded-[12px] border-[1.5px] px-3.5 text-[14px] outline-none"
                style={{ borderColor: "var(--p-border)" }}
              />
            </Field>
          )}

          <Field label="Message">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder="Hello {{name}}, ..."
              className="w-full rounded-[12px] border-[1.5px] p-3 text-[14px] leading-relaxed outline-none"
              style={{ borderColor: "var(--p-border)" }}
            />
          </Field>

          {variables.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide" style={{ color: "var(--p-text-tertiary)" }}>
                Detected variables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <span key={v} className="p-trait p-trait-blue">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <button className="p-btn p-btn-primary mt-5 w-full" disabled={!canSubmit || pending} onClick={() => void submit()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : template ? "Save changes" : "Add template"}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
        {label}
      </span>
      {children}
    </label>
  )
}
