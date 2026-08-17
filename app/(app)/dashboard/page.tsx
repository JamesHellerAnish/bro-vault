"use client"

// PLAN.md section 7. A broker sees their own numbers; an admin sees the same layout plus
// the org-wide blocks underneath.
//
// The client never decides whose numbers these are. It calls broker_metrics(null) and the
// database clamps a broker to themselves. The `isAdmin` checks below only decide which
// *extra* panels to render -- if one were wrong, the RPC would refuse rather than leak.

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, Loader2, Minus } from "lucide-react"
import { toast } from "sonner"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { ChartCard } from "@/components/charts/ChartCard"
// Code-split: Recharts is ~108 kB and this is the landing route. See components/charts/lazy.tsx.
import { ActivityMixChart, ConversionTrendChart, PipelineFunnelChart } from "@/components/charts/lazy"
import {
  lastNDays,
  useActivitySummary,
  useBrokerMetrics,
  useConversionTrend,
  useLeaderboard,
  usePipelineFunnel,
  useSourcePerformance,
  useUnattendedLeads,
} from "@/hooks/useMetrics"
import { useExportLeaderboard } from "@/hooks/useExport"
import { useAuth } from "@/lib/auth/useAuth"
import { ACTIVITY_LABEL, PIPELINE_ORDER, STATUS_LABEL } from "@/lib/status"
import { durationFromHours, initials, inr, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
] as const

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth()
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("30")
  const days = RANGES.find((r) => r.key === rangeKey)!.days
  const range = useMemo(() => lastNDays(days), [days])

  const { data: metrics, isLoading } = useBrokerMetrics(range)
  const { data: funnel = [], isFetching: funnelFetching } = usePipelineFunnel(range)
  const { data: trend = [], isFetching: trendFetching } = useConversionTrend(range, days > 30 ? "week" : "day")
  const { data: activity = [], isFetching: activityFetching } = useActivitySummary(range)
  const { data: leaderboard = [], isFetching: leaderboardFetching } = useLeaderboard(range, isAdmin)
  const { data: sources = [], isFetching: sourcesFetching } = useSourcePerformance(range, isAdmin)
  const { data: unattended = [] } = useUnattendedLeads(isAdmin)

  const exportLeaderboard = useExportLeaderboard()

  return (
    <>
      <BrokerTopBar title={isAdmin ? "Org dashboard" : "Dashboard"} />

      <div className="px-4 py-4">
        <p className="text-[13px]" style={{ color: "var(--p-text-secondary)" }}>
          {greeting()}, {profile?.full_name.split(/\s+/)[0]}
        </p>

        <div className="p-tabs mt-3">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={cn("p-tab", rangeKey === r.key && "p-tab-active")}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Today's work first: the follow-up counts are the only numbers that are a
            to-do list rather than a report. */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Link href="/follow-ups" className="p-stat-card p-card-interactive" style={{ ["--accent-color" as string]: "var(--p-brand)" }}>
            <div className="p-stat-value">{isLoading ? "—" : metrics?.follow_ups_due_today ?? 0}</div>
            <div className="p-stat-label">Due today</div>
          </Link>
          <Link
            href="/follow-ups?tab=overdue"
            className="p-stat-card p-card-interactive"
            style={{ ["--accent-color" as string]: "#DC2626" }}
          >
            <div className="p-stat-value" style={{ color: (metrics?.follow_ups_overdue ?? 0) > 0 ? "#DC2626" : undefined }}>
              {isLoading ? "—" : metrics?.follow_ups_overdue ?? 0}
            </div>
            <div className="p-stat-label">Overdue</div>
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Leads received" value={metrics?.leads_received} loading={isLoading} accent="var(--p-blue)" />
          <Stat label="Converted" value={metrics?.leads_converted} loading={isLoading} accent="var(--p-green)" />
        </div>

        <div className="p-stat-card mt-3" style={{ ["--accent-color" as string]: "var(--p-purple)" }}>
          <div className="flex items-end justify-between">
            <div>
              <div className="p-stat-value">
                {isLoading ? "—" : `${metrics?.conversion_rate ?? 0}%`}
              </div>
              <div className="p-stat-label">Conversion rate</div>
            </div>
            <Delta current={metrics?.conversion_rate} previous={metrics?.prev_conversion_rate} />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--p-text-tertiary)" }}>
            Of the leads received in this window, the share that has converted. Compared with
            the previous {days} days.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat
            label="Avg. to convert"
            value={durationFromHours(metrics?.avg_conversion_hours)}
            loading={isLoading}
            accent="var(--p-amber)"
          />
          <Stat
            label="Avg. to first contact"
            value={durationFromHours(metrics?.avg_first_contact_hours)}
            loading={isLoading}
            accent="var(--p-blue)"
          />
        </div>

        {/* Funnel */}
        <div className="mt-4">
          <ChartCard
            title="Pipeline"
            subtitle="Leads received in this window, by stage"
            isFetching={funnelFetching}
            isEmpty={funnel.every((f) => f.lead_count === 0)}
            tableColumns={[{ header: "Stage" }, { header: "Leads", align: "right" }]}
            tableRows={PIPELINE_ORDER.map((stage) => [
              STATUS_LABEL[stage],
              funnel.find((f) => f.status === stage)?.lead_count ?? 0,
            ])}
          >
            <PipelineFunnelChart funnel={funnel} />
          </ChartCard>
        </div>

        <div className="mt-4">
          <ChartCard
            title="Received vs converted"
            subtitle={`Both on one scale -- the gap is the conversion story`}
            isFetching={trendFetching}
            isEmpty={trend.length === 0}
            tableColumns={[{ header: "Period" }, { header: "Received", align: "right" }, { header: "Converted", align: "right" }]}
            tableRows={trend.map((t) => [
              new Date(t.bucket_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
              t.leads_received,
              t.leads_converted,
            ])}
          >
            <ConversionTrendChart points={trend} />
          </ChartCard>
        </div>

        <div className="mt-4">
          <ChartCard
            title="Activity"
            subtitle="Effort logged in this window"
            isFetching={activityFetching}
            isEmpty={activity.length === 0}
            emptyMessage="No calls, messages or meetings logged yet."
            tableColumns={[{ header: "Type" }, { header: "Count", align: "right" }]}
            tableRows={activity.map((a) => [ACTIVITY_LABEL[a.type], a.activity_count])}
          >
            <ActivityMixChart rows={activity} />
          </ChartCard>
        </div>

        {/* Admin-only blocks */}
        {isAdmin && unattended.length > 0 && (
          <section className="p-card mt-4 p-4" style={{ borderLeft: "3px solid #DC2626" }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-[18px] w-[18px] text-red-600" />
              <h2 className="p-section-title">Unattended leads</h2>
            </div>
            <p className="p-section-subtitle">Assigned a while ago with no call, message or meeting</p>
            <ul className="mt-3 divide-y" style={{ borderColor: "var(--p-border-subtle)" }}>
              {unattended.slice(0, 6).map((u) => (
                <li key={u.lead_id} className="py-2.5">
                  <Link href={`/leads/${u.lead_id}`} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                        {u.full_name}
                      </p>
                      <p className="text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
                        {u.broker_name} · assigned {relativeTime(u.assigned_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-semibold text-red-600">
                      {Math.round(u.hours_waiting)}h
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isAdmin && (
          <section className="p-card mt-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="p-section-title">Team</h2>
                <p className="p-section-subtitle">Conversion rate over the last {days} days</p>
              </div>
              {leaderboard.length > 0 && (
                <button
                  className="p-chip shrink-0 !px-3 !py-1.5 !text-[12px]"
                  disabled={exportLeaderboard.isPending}
                  onClick={() =>
                    exportLeaderboard.mutate(range, {
                      onSuccess: (n) => toast.success(`Exported ${n} broker${n === 1 ? "" : "s"}`),
                      onError: (e) => toast.error((e as Error).message),
                    })
                  }
                >
                  {exportLeaderboard.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  CSV
                </button>
              )}
            </div>
            {leaderboard.length === 0 ? (
              <p className="mt-3 text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
                No broker activity in this window.
              </p>
            ) : (
              <ul className="mt-3 divide-y" style={{ borderColor: "var(--p-border-subtle)" }}>
                {leaderboard.map((b, i) => (
                  <li key={b.broker_id} className="flex items-center gap-3 py-3">
                    <span className="w-4 text-[13px] font-bold" style={{ color: "var(--p-text-tertiary)" }}>
                      {i + 1}
                    </span>
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{ background: "var(--p-brand-light)", color: "var(--p-brand-dark)" }}
                    >
                      {initials(b.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                        {b.full_name}
                      </p>
                      <p className="text-[12px]" style={{ color: "var(--p-text-tertiary)" }}>
                        {b.leads_converted}/{b.leads_handled} converted · first contact{" "}
                        {durationFromHours(b.avg_first_contact_hours)}
                      </p>
                    </div>
                    <span className="text-[15px] font-bold" style={{ color: "var(--p-text)" }}>
                      {b.conversion_rate}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Source performance is deliberately a table, not a chart. It carries four measures
            per source -- received, converted, rate, premium -- and count and rate are
            different scales. Plotting both would mean a dual axis, which invents a
            correlation that is not in the data; four measures across N sources is what a
            table is for. The inline meter re-encodes the rate that is already printed
            beside it, so it is redundancy rather than the only way to read the value. */}
        {isAdmin && sources.length > 0 && (
          <section className="p-card mt-4 p-4" style={{ opacity: sourcesFetching ? 0.45 : 1 }}>
            <h2 className="p-section-title">Where leads come from</h2>
            <p className="p-section-subtitle">Which channel actually converts, last {days} days</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {["Source", "Leads", "Converted", "Rate", "Premium"].map((h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cn("border-b pb-2 font-medium", i > 0 && "text-right")}
                        style={{ color: "var(--p-text-tertiary)", borderColor: "var(--p-border)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source_id ?? s.source_label}>
                      <td className="border-b py-2.5" style={{ color: "var(--p-text)", borderColor: "var(--p-border-subtle)" }}>
                        {s.source_label}
                        <span className="mt-1 block h-1 w-full max-w-[110px] overflow-hidden rounded-full" style={{ background: "#F3F4F6" }}>
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${Math.min(s.conversion_rate, 100)}%`, background: "var(--p-brand)" }}
                          />
                        </span>
                      </td>
                      <td className="border-b py-2.5 text-right tabular-nums" style={{ color: "var(--p-text-secondary)", borderColor: "var(--p-border-subtle)" }}>
                        {s.leads_received}
                      </td>
                      <td className="border-b py-2.5 text-right tabular-nums" style={{ color: "var(--p-text-secondary)", borderColor: "var(--p-border-subtle)" }}>
                        {s.leads_converted}
                      </td>
                      <td className="border-b py-2.5 text-right font-semibold tabular-nums" style={{ color: "var(--p-text)", borderColor: "var(--p-border-subtle)" }}>
                        {s.conversion_rate}%
                      </td>
                      <td className="border-b py-2.5 text-right tabular-nums" style={{ color: "var(--p-text-secondary)", borderColor: "var(--p-border-subtle)" }}>
                        {inr(s.total_premium, { compact: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  loading,
  accent,
}: {
  label: string
  value: number | string | undefined
  loading: boolean
  accent: string
}) {
  return (
    <div className="p-stat-card" style={{ ["--accent-color" as string]: accent }}>
      <div className="p-stat-value">{loading ? "—" : value ?? 0}</div>
      <div className="p-stat-label">{label}</div>
    </div>
  )
}

/** Trend against the previous period. A flat line is shown as flat, not as 0% growth. */
function Delta({ current, previous }: { current?: number; previous?: number }) {
  if (current === undefined || previous === undefined) return null
  const diff = Number((current - previous).toFixed(1))
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus
  const color = diff > 0 ? "var(--p-green)" : diff < 0 ? "#DC2626" : "var(--p-text-tertiary)"
  return (
    <span className="flex items-center gap-1 text-[13px] font-semibold" style={{ color }}>
      <Icon className="h-4 w-4" />
      {diff === 0 ? "flat" : `${Math.abs(diff)} pts`}
    </span>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}
