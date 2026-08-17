"use client"

// hooks/useMetrics.ts
//
// Thin wrappers over the RPCs in supabase/migrations/...000700_metric_functions.sql.
//
// Every one of these passes p_broker_id straight through from the caller without checking
// anything. That is deliberate and safe: resolve_metric_scope in the database clamps a
// broker to their own slice whatever is passed, and the org-wide functions raise for a
// non-admin. Re-implementing the check here would add a second copy of the rule that could
// drift from the real one -- and the client copy would be the fake one.

import { useQuery } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type {
  ActivitySummaryRow,
  BrokerMetrics,
  ConversionTrendPoint,
  FunnelStage,
  LeaderboardRow,
  SourcePerformanceRow,
  UnattendedLead,
} from "@/lib/supabase/types"

export interface DateRange {
  from: Date
  to: Date
}

export function lastNDays(n: number): DateRange {
  const to = new Date()
  const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000)
  return { from, to }
}

function rangeArgs(range: DateRange) {
  return { p_from: range.from.toISOString(), p_to: range.to.toISOString() }
}

export function useBrokerMetrics(range: DateRange, brokerId?: string | null) {
  return useQuery({
    queryKey: ["metrics", "broker", brokerId ?? "self", range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("broker_metrics", {
        p_broker_id: brokerId ?? null,
        ...rangeArgs(range),
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return (row as BrokerMetrics) ?? null
    },
  })
}

export function usePipelineFunnel(range: DateRange, brokerId?: string | null) {
  return useQuery({
    queryKey: ["metrics", "funnel", brokerId ?? "self", range.from.toISOString()],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("pipeline_funnel", {
        p_broker_id: brokerId ?? null,
        ...rangeArgs(range),
      })
      if (error) throw error
      return (data ?? []) as FunnelStage[]
    },
  })
}

export function useConversionTrend(
  range: DateRange,
  bucket: "day" | "week" | "month" = "week",
  brokerId?: string | null
) {
  return useQuery({
    queryKey: ["metrics", "trend", bucket, brokerId ?? "self", range.from.toISOString()],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("conversion_trend", {
        p_broker_id: brokerId ?? null,
        p_bucket: bucket,
        ...rangeArgs(range),
      })
      if (error) throw error
      return (data ?? []) as ConversionTrendPoint[]
    },
  })
}

export function useActivitySummary(range: DateRange, brokerId?: string | null) {
  return useQuery({
    queryKey: ["metrics", "activity", brokerId ?? "self", range.from.toISOString()],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("activity_summary", {
        p_broker_id: brokerId ?? null,
        ...rangeArgs(range),
      })
      if (error) throw error
      return (data ?? []) as ActivitySummaryRow[]
    },
  })
}

// ---------------------------------------------------------------------------
// Admin-only. These raise 42501 for a broker rather than returning a clamped result.
// `enabled` keeps the query from firing at all for a non-admin -- not as a security
// measure (the database refuses regardless) but so the UI does not log an expected error.
// ---------------------------------------------------------------------------

export function useLeaderboard(range: DateRange, enabled: boolean) {
  return useQuery({
    queryKey: ["metrics", "leaderboard", range.from.toISOString()],
    enabled,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("broker_leaderboard", rangeArgs(range))
      if (error) throw error
      return (data ?? []) as LeaderboardRow[]
    },
  })
}

export function useUnattendedLeads(enabled: boolean) {
  return useQuery({
    queryKey: ["metrics", "unattended"],
    enabled,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("unattended_leads", { p_limit: 50 })
      if (error) throw error
      return (data ?? []) as UnattendedLead[]
    },
  })
}

/**
 * Which channel actually converts. Admin-only -- source_performance raises 42501 for a
 * broker, so `enabled` here is only to keep the UI from logging an expected error, not a
 * security check.
 */
export function useSourcePerformance(range: DateRange, enabled: boolean) {
  return useQuery({
    queryKey: ["metrics", "sources", range.from.toISOString()],
    enabled,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("source_performance", rangeArgs(range))
      if (error) throw error
      return (data ?? []) as SourcePerformanceRow[]
    },
  })
}
