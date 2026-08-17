"use client"

// The lead detail screen from PLAN.md section 5. Header, sticky action bar, Details /
// Timeline tabs, trait chips, status control, follow-up.
//
// The read-only case is a first-class state here, not a disabled-everything afterthought.
// In open mode a broker can see a colleague's lead but not change it; if the UI just
// silently ignored their taps that would read as a broken app. So the banner says why, and
// the write controls are absent rather than dead.
//
// Note that `canEdit` below is presentation only. Every mutation goes through the same RLS
// policies regardless, and useUpdateLead throws if the database returns zero rows -- so a
// bug in this calculation produces a visible error, never a silent unauthorised write.

import { use, useState } from "react"
import { ArrowRightLeft, Copy, Lock, Mail, MessageCircle, Phone } from "lucide-react"
import { toast } from "sonner"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { DocumentsTab } from "@/components/leads/DocumentsTab"
import { LeadTimeline, NoteComposer } from "@/components/leads/LeadTimeline"
import { ReassignSheet } from "@/components/team/ReassignSheet"
import { WhatsAppComposer } from "@/components/leads/WhatsAppComposer"
import {
  useConfirmActivity,
  useLead,
  useLeadActivities,
  useLogActivity,
  useSetLeadTraits,
  useUpdateLead,
} from "@/hooks/useLeads"
import { useOrgSettings, useTraits } from "@/hooks/useOrg"
import { useAuth } from "@/lib/auth/useAuth"
import {
  PIPELINE_ORDER,
  STATUS_BADGE_CLASS,
  STATUS_LABEL,
  TEMPERATURE_CLASS,
  TEMPERATURE_LABEL,
  TERMINAL_STATUSES,
  traitClass,
} from "@/lib/status"
import { inr, initials, prettyPhone, relativeDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { LeadStatus } from "@/lib/supabase/types"

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { profile, isAdmin } = useAuth()
  const { data: org } = useOrgSettings()
  const { data: lead, isLoading, error } = useLead(id)
  const { data: activities = [], isLoading: activitiesLoading } = useLeadActivities(id)
  const { data: allTraits = [] } = useTraits()

  const updateLead = useUpdateLead(id)
  const logActivity = useLogActivity(id)
  const setTraits = useSetLeadTraits(id)
  const confirmActivity = useConfirmActivity(id)

  const [tab, setTab] = useState<"details" | "timeline" | "documents">("details")
  const [waOpen, setWaOpen] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [editingTraits, setEditingTraits] = useState(false)

  if (isLoading) {
    return (
      <>
        <BrokerTopBar title="Lead" back />
        <div className="space-y-3 p-4">
          <div className="p-skeleton h-6 w-1/2" />
          <div className="p-skeleton h-4 w-1/3" />
          <div className="p-skeleton h-24 w-full rounded-card" />
        </div>
      </>
    )
  }

  // A lead the caller may not see returns null, exactly as a non-existent one does. The
  // API must not confirm that a hidden lead exists, so the message stays the same for both.
  if (error || !lead || !profile) {
    return (
      <>
        <BrokerTopBar title="Lead" back />
        <div className="p-empty">
          <Lock className="mb-3 h-8 w-8" />
          <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
            Lead not available
          </p>
          <p className="mt-1 max-w-xs text-[13px]">
            It may have been reassigned, or it may not be shared with you.
          </p>
        </div>
      </>
    )
  }

  const mine = lead.assigned_to === profile.id
  const canEdit =
    isAdmin ||
    mine ||
    (org?.lead_visibility === "all" && org.allow_cross_broker_edit && !lead.is_private)

  const traits = lead.lead_traits?.map((t) => t.trait).filter(Boolean) ?? []
  const selectedTraitIds = new Set(traits.map((t) => t.id))
  const due = relativeDue(lead.next_follow_up_at)

  async function setStatus(status: LeadStatus) {
    try {
      await updateLead.mutateAsync({ status })
      toast.success(`Moved to ${STATUS_LABEL[status]}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function logCall() {
    try {
      await logActivity.mutateAsync({ type: "call", direction: "out", actorId: profile!.id })
      toast.success("Call logged")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <BrokerTopBar title={lead.full_name} back />

      {!canEdit && (
        <div className="p-readonly-bar">
          <Lock className="h-3.5 w-3.5" />
          View only — {lead.assignee?.full_name ?? "another broker"} is handling this lead.
        </div>
      )}

      {/* Header */}
      <div className="bg-white px-4 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
              {lead.full_name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={TEMPERATURE_CLASS[lead.temperature]}>
                {TEMPERATURE_LABEL[lead.temperature]}
              </span>
              {lead.lead_insurance_types?.map(({ insurance_type }) => (
                <span key={insurance_type.id} className="text-[13px]" style={{ color: "var(--p-text-secondary)" }}>
                  {insurance_type.label}
                </span>
              ))}
              {lead.is_private && (
                <span className="p-trait p-trait-violet">
                  <Lock className="h-3 w-3" /> Private
                </span>
              )}
            </div>
          </div>
          <span className={STATUS_BADGE_CLASS[lead.status]}>{STATUS_LABEL[lead.status]}</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ background: "var(--p-brand-light)", color: "var(--p-brand-dark)" }}
          >
            {initials(lead.assignee?.full_name)}
          </span>
          <span className="text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
            Assigned to {mine ? "you" : lead.assignee?.full_name ?? "nobody"}
          </span>
          {/* PLAN.md section 5's wireframe: "Assigned: Ankit  (Admin: ⇄)" -- admin-only,
              same reassignment the /team queue uses. guard_lead_columns (Phase 1) refuses
              this write for anyone else, so the button simply isn't drawn for them. */}
          {isAdmin && (
            <button
              onClick={() => setReassigning(true)}
              className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: "#F3F4F6" }}
              aria-label="Reassign this lead"
              title="Reassign"
            >
              <ArrowRightLeft className="h-3 w-3" style={{ color: "var(--p-text-secondary)" }} />
            </button>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="p-action-bar">
        <a href={`tel:${lead.phone}`} className="p-action-btn p-action-call" onClick={() => void logCall()}>
          <Phone className="h-4 w-4" /> Call
        </a>
        <button
          className="p-action-btn p-action-whatsapp"
          onClick={() => setWaOpen(true)}
          disabled={!canEdit}
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </button>
        <a
          href={lead.email ? `mailto:${lead.email}` : undefined}
          className={cn("p-action-btn", !lead.email && "pointer-events-none opacity-40")}
        >
          <Mail className="h-4 w-4" /> Email
        </a>
      </div>

      {/* Traits */}
      <div className="border-b bg-white px-4 py-3.5" style={{ borderColor: "var(--p-border)" }}>
        <div className="flex flex-wrap gap-1.5">
          {traits.map((t) => (
            <span key={t.id} className={traitClass(t.color)}>
              {t.label}
            </span>
          ))}
          {traits.length === 0 && !editingTraits && (
            <span className="text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
              No traits yet
            </span>
          )}
          {canEdit && (
            <button
              className="p-trait p-trait-slate"
              onClick={() => setEditingTraits((v) => !v)}
            >
              {editingTraits ? "Done" : "+ Edit"}
            </button>
          )}
        </div>

        {editingTraits && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {allTraits.map((t) => {
              const on = selectedTraitIds.has(t.id)
              return (
                <button
                  key={t.id}
                  className={cn("p-chip !px-3 !py-1.5 !text-[12.5px]", on && "p-chip-active")}
                  onClick={() => {
                    const next = on
                      ? [...selectedTraitIds].filter((x) => x !== t.id)
                      : [...selectedTraitIds, t.id]
                    setTraits.mutate(
                      { traitIds: next, actorId: profile.id },
                      { onError: (e) => toast.error((e as Error).message) }
                    )
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white px-4 py-3">
        <div className="p-tabs">
          <button className={cn("p-tab", tab === "details" && "p-tab-active")} onClick={() => setTab("details")}>
            Details
          </button>
          <button className={cn("p-tab", tab === "timeline" && "p-tab-active")} onClick={() => setTab("timeline")}>
            Timeline
          </button>
          <button className={cn("p-tab", tab === "documents" && "p-tab-active")} onClick={() => setTab("documents")}>
            Docs
          </button>
        </div>
      </div>

      {tab === "details" ? (
        <div className="space-y-3 px-4 py-2 pb-8">
          <div className="p-card p-4">
            <Row label="Phone" value={prettyPhone(lead.phone)} copy={lead.phone} />
            {lead.whatsapp_number && (
              <Row label="WhatsApp" value={prettyPhone(lead.whatsapp_number)} copy={lead.whatsapp_number} />
            )}
            {lead.email && <Row label="Email" value={lead.email} copy={lead.email} />}
            <Row
              label="About"
              value={[
                lead.age ? `${lead.age}` : null,
                lead.gender && lead.gender !== "undisclosed" ? lead.gender : null,
                lead.city,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            {lead.source?.label && <Row label="Source" value={lead.source.label} />}
            {lead.budget_expectation !== null && (
              <Row label="Budget" value={`${inr(lead.budget_expectation)} / year`} />
            )}
            {lead.occupation && <Row label="Occupation" value={lead.occupation} />}
          </div>

          {lead.description && (
            <div className="p-card p-4">
              <p className="p-stat-label mb-2">Description</p>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: "var(--p-text-secondary)" }}>
                {lead.description}
              </p>
            </div>
          )}

          <div className="p-card p-4">
            <p className="p-stat-label mb-2">Next follow-up</p>
            <p
              className="text-[15px] font-semibold"
              style={{ color: due.overdue ? "#DC2626" : "var(--p-text)" }}
            >
              {due.label}
            </p>
            {canEdit && (
              <input
                type="datetime-local"
                className="mt-3 w-full rounded-xl border-[1.5px] px-3 py-2.5 text-[14px] outline-none"
                style={{ borderColor: "var(--p-border)" }}
                value={lead.next_follow_up_at ? toLocalInput(lead.next_follow_up_at) : ""}
                onChange={(e) => {
                  const v = e.target.value
                  updateLead.mutate(
                    { next_follow_up_at: v ? new Date(v).toISOString() : null },
                    { onError: (err) => toast.error((err as Error).message) }
                  )
                }}
              />
            )}
          </div>

          {canEdit && (
            <div className="p-card p-4">
              <p className="p-stat-label mb-3">Pipeline stage</p>
              <div className="flex flex-wrap gap-1.5">
                {[...PIPELINE_ORDER, ...TERMINAL_STATUSES].map((s) => (
                  <button
                    key={s}
                    className={cn("p-chip !px-3 !py-1.5 !text-[12.5px]", lead.status === s && "p-chip-active")}
                    onClick={() => void setStatus(s)}
                    disabled={updateLead.isPending}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : tab === "timeline" ? (
        <>
          <LeadTimeline
            activities={activities}
            isLoading={activitiesLoading}
            canEdit={canEdit}
            onConfirmSent={(activityId, sent) =>
              confirmActivity.mutate(
                { activityId, sent },
                {
                  // Recorded as an outcome on the existing entry rather than a new one, so
                  // the timeline shows one event with a verdict, not two events.
                  onSuccess: () => toast.success(sent ? "Marked as sent" : "Marked as not sent"),
                  onError: (e) => toast.error((e as Error).message),
                }
              )
            }
          />
          <NoteComposer
            disabled={!canEdit || logActivity.isPending}
            onSubmit={(body) =>
              logActivity.mutate(
                { type: "note", body, actorId: profile.id },
                { onError: (e) => toast.error((e as Error).message) }
              )
            }
          />
        </>
      ) : (
        <DocumentsTab leadId={lead.id} myProfileId={profile.id} canEdit={canEdit} />
      )}

      {waOpen && (
        <WhatsAppComposer
          lead={lead}
          me={profile}
          orgName={org?.org_name ?? "MyInsuranceBro"}
          onClose={() => setWaOpen(false)}
          onSent={({ templateId, body }) =>
            logActivity.mutate({
              type: "whatsapp",
              direction: "out",
              body,
              template_id: templateId ?? undefined,
              is_optimistic: true,
              actorId: profile.id,
            })
          }
        />
      )}

      {reassigning && (
        <ReassignSheet
          title="Reassign lead"
          excludeBrokerId={lead.assigned_to}
          pending={updateLead.isPending}
          onClose={() => setReassigning(false)}
          onPick={(toBrokerId) =>
            updateLead.mutate(
              { assigned_to: toBrokerId },
              {
                onSuccess: () => {
                  toast.success("Lead reassigned")
                  setReassigning(false)
                },
                onError: (e) => toast.error((e as Error).message),
              }
            )
          }
        />
      )}
    </>
  )
}

function Row({ label, value, copy }: { label: string; value: string; copy?: string }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
        {label}
      </span>
      <span className="flex items-center gap-2 text-right text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
        {value}
        {copy && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(copy)
              toast.success("Copied")
            }}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" style={{ color: "var(--p-text-tertiary)" }} />
          </button>
        )}
      </span>
    </div>
  )
}

/** ISO -> the local "YYYY-MM-DDTHH:mm" that datetime-local expects. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
