"use client"

// Per-broker detail: PLAN.md section 8's "per-broker stats, reassign leads". Stats reuse
// broker_metrics(range, brokerId) from Phase 2 -- the same RPC the dashboard calls on
// itself, here pointed at someone else, which only an admin may do
// (app_private.resolve_metric_scope clamps a non-admin regardless of what is passed).

import { use, useState } from "react"
import Link from "next/link"
import { ArrowRightLeft, UserX } from "lucide-react"
import { toast } from "sonner"
import { AdminOnly } from "@/components/broker/AdminOnly"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { ReassignSheet } from "@/components/team/ReassignSheet"
import { useBrokerOpenLeads, useBulkReassignLeads, useProfile, useSetProfileActive } from "@/hooks/useTeam"
import { useUpdateLead } from "@/hooks/useLeads"
import { lastNDays, useBrokerMetrics } from "@/hooks/useMetrics"
import { STATUS_LABEL } from "@/lib/status"
import { durationFromHours, initials, prettyPhone, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function BrokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AdminOnly>
      <BrokerDetailContent params={params} />
    </AdminOnly>
  )
}

function BrokerDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const range = lastNDays(30)

  const { data: broker, isLoading } = useProfile(id)
  const { data: metrics } = useBrokerMetrics(range, id)
  const { data: openLeads = [] } = useBrokerOpenLeads(id)
  const setActive = useSetProfileActive()
  const bulkReassign = useBulkReassignLeads()

  const [bulkSheetOpen, setBulkSheetOpen] = useState(false)
  const [singleReassignLeadId, setSingleReassignLeadId] = useState<string | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())

  if (isLoading || !broker) {
    return (
      <>
        <BrokerTopBar title="Broker" back />
        <div className="space-y-3 p-4">
          <div className="p-skeleton h-6 w-1/2" />
          <div className="p-skeleton h-20 w-full rounded-card" />
        </div>
      </>
    )
  }

  function toggleSelected(leadId: string) {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev)
      next.has(leadId) ? next.delete(leadId) : next.add(leadId)
      return next
    })
  }

  async function deactivate() {
    if (openLeads.length > 0) {
      toast.error(`Reassign ${openLeads.length} open lead${openLeads.length === 1 ? "" : "s"} first.`)
      return
    }
    try {
      await setActive.mutateAsync({ id, isActive: false })
      toast.success(`${broker!.full_name} deactivated`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <BrokerTopBar title={broker.full_name} back />

      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-[17px] font-bold"
            style={{
              background: broker.is_active ? "var(--p-brand-light)" : "#F1F5F9",
              color: broker.is_active ? "var(--p-brand-dark)" : "#64748B",
            }}
          >
            {initials(broker.full_name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
              {broker.full_name}
            </h2>
            <p className="text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
              {prettyPhone(broker.phone)} · <span className="capitalize">{broker.role}</span>
            </p>
          </div>
          {!broker.is_active && (
            <span className="ml-auto p-trait p-trait-red shrink-0">Deactivated</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Leads received (30d)" value={metrics?.leads_received} />
          <Stat label="Converted (30d)" value={metrics?.leads_converted} />
          <Stat label="Conversion rate" value={metrics ? `${metrics.conversion_rate}%` : undefined} />
          <Stat label="Avg. first contact" value={metrics ? durationFromHours(metrics.avg_first_contact_hours) : undefined} />
        </div>

        <section className="p-card mt-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="p-section-title">Open leads</h2>
              <p className="p-section-subtitle">
                {openLeads.length} still in the pipeline
                {!broker.is_active && " -- these need a new owner"}
              </p>
            </div>
            {openLeads.length > 0 && selectedLeadIds.size > 0 && (
              <button
                className="p-chip !px-3 !py-1.5 !text-[12px]"
                onClick={() => setBulkSheetOpen(true)}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Reassign {selectedLeadIds.size}
              </button>
            )}
          </div>

          {openLeads.length === 0 ? (
            <p className="mt-3 text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
              Nothing open right now.
            </p>
          ) : (
            <ul className="mt-3 divide-y" style={{ borderColor: "var(--p-border-subtle)" }}>
              {openLeads.map((lead) => (
                <li key={lead.id} className="flex items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.has(lead.id)}
                    onChange={() => toggleSelected(lead.id)}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Select ${lead.full_name}`}
                  />
                  <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                      {lead.full_name}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
                      {STATUS_LABEL[lead.status]} · {relativeTime(lead.created_at)}
                    </p>
                  </Link>
                  <button
                    className="shrink-0 text-[12px] font-medium"
                    style={{ color: "var(--p-brand)" }}
                    onClick={() => setSingleReassignLeadId(lead.id)}
                  >
                    Reassign
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {broker.is_active ? (
          <button className="p-btn p-btn-outline mt-5 w-full" onClick={() => void deactivate()}>
            <UserX className="h-[18px] w-[18px]" />
            Deactivate
          </button>
        ) : (
          <button
            className="p-btn p-btn-primary mt-5 w-full"
            onClick={() =>
              setActive.mutate(
                { id, isActive: true },
                {
                  onSuccess: () => toast.success(`${broker.full_name} reactivated`),
                  onError: (e) => toast.error((e as Error).message),
                }
              )
            }
          >
            Reactivate
          </button>
        )}
      </div>

      {bulkSheetOpen && (
        <ReassignSheet
          title={`Reassign ${selectedLeadIds.size} lead${selectedLeadIds.size === 1 ? "" : "s"}`}
          excludeBrokerId={id}
          pending={bulkReassign.isPending}
          onClose={() => setBulkSheetOpen(false)}
          onPick={(toBrokerId) =>
            bulkReassign.mutate(
              { leadIds: [...selectedLeadIds], toBrokerId },
              {
                onSuccess: () => {
                  toast.success("Leads reassigned")
                  setSelectedLeadIds(new Set())
                  setBulkSheetOpen(false)
                },
                onError: (e) => toast.error((e as Error).message),
              }
            )
          }
        />
      )}

      {singleReassignLeadId && (
        <SingleReassign
          leadId={singleReassignLeadId}
          excludeBrokerId={id}
          onDone={() => setSingleReassignLeadId(null)}
        />
      )}
    </>
  )
}

// A separate component because useUpdateLead is parameterised by leadId at the hook level
// (it targets one row for its cache invalidation) -- calling it fresh per selected lead
// keeps that contract rather than threading a dynamic id through a single hook instance.
function SingleReassign({
  leadId,
  excludeBrokerId,
  onDone,
}: {
  leadId: string
  excludeBrokerId: string
  onDone: () => void
}) {
  const updateLead = useUpdateLead(leadId)
  return (
    <ReassignSheet
      title="Reassign lead"
      excludeBrokerId={excludeBrokerId}
      pending={updateLead.isPending}
      onClose={onDone}
      onPick={(toBrokerId) =>
        updateLead.mutate(
          { assigned_to: toBrokerId },
          {
            onSuccess: () => {
              toast.success("Lead reassigned")
              onDone()
            },
            onError: (e) => toast.error((e as Error).message),
          }
        )
      }
    />
  )
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="p-stat-card">
      <div className="p-stat-value">{value ?? "—"}</div>
      <div className="p-stat-label">{label}</div>
    </div>
  )
}
