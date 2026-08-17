"use client"

// The leads list. PLAN.md section 8 + section 13's ported patterns:
//   - pill tabs over separate routes for filtering (All / Mine / one per stage)
//   - infinite scroll with an IntersectionObserver sentinel, page size 20
//   - skeleton cards while loading, not a spinner
//   - a thumb-reachable FAB for "Add lead"
//
// The list never filters by visibility. It asks for leads and renders what comes back;
// which rows come back is the database's decision.

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Download, Loader2, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { toast } from "sonner"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { LeadCard, LeadCardSkeleton } from "@/components/leads/LeadCard"
import { useLeadsInfinite, type LeadFilters } from "@/hooks/useLeads"
import { useExportLeads } from "@/hooks/useExport"
import { useOrgSettings } from "@/hooks/useOrg"
import { useAuth } from "@/lib/auth/useAuth"
import { PIPELINE_ORDER, STATUS_LABEL, TERMINAL_STATUSES } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { LeadStatus } from "@/lib/supabase/types"

type Tab = "all" | "mine" | LeadStatus

export default function LeadsPage() {
  const { profile } = useAuth()
  const { data: org } = useOrgSettings()
  const [tab, setTab] = useState<Tab>("all")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [showTerminal, setShowTerminal] = useState(false)

  // 250ms is short enough to feel live and long enough that typing a 10-digit phone number
  // does not fire ten queries.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const filters = useMemo<LeadFilters>(() => {
    const base: LeadFilters = { search: debounced, myProfileId: profile?.id ?? null }
    if (tab === "mine") return { ...base, scope: "mine" }
    if (tab === "all") return base
    return { ...base, status: [tab] }
  }, [tab, debounced, profile?.id])

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useLeadsInfinite(filters)
  const exportLeads = useExportLeads()

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      // Start loading before the sentinel is actually on screen, so the next page is
      // usually there by the time the user reaches it.
      { rootMargin: "400px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const leads = data?.pages.flat() ?? []
  const openMode = org?.lead_visibility === "all"

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: openMode ? "All leads" : "My leads" },
    ...(openMode ? [{ key: "mine" as Tab, label: "Mine" }] : []),
    ...PIPELINE_ORDER.map((s) => ({ key: s as Tab, label: STATUS_LABEL[s] })),
    ...(showTerminal ? TERMINAL_STATUSES.map((s) => ({ key: s as Tab, label: STATUS_LABEL[s] })) : []),
  ]

  return (
    <>
      <BrokerTopBar title="Leads" />

      <div className="sticky top-[var(--p-topbar-h)] z-20 border-b bg-white/90 backdrop-blur-xl"
        style={{ borderColor: "var(--p-border)" }}>
        <div className="px-4 pt-3">
          <div
            className="flex items-center gap-2 rounded-[14px] border-[1.5px] px-3.5"
            style={{ borderColor: "var(--p-border)" }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--p-text-tertiary)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, city"
              className="h-11 flex-1 bg-transparent text-[15px] outline-none"
              style={{ color: "var(--p-text)" }}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Clear search">
                <X className="h-4 w-4" style={{ color: "var(--p-text-tertiary)" }} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
          <div className="p-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn("p-tab", tab === t.key && "p-tab-active")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            className="ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium"
            style={{ background: "#F3F4F6", color: "var(--p-text-secondary)" }}
            disabled={exportLeads.isPending}
            onClick={() =>
              exportLeads.mutate(
                { scope: tab === "mine" ? "mine" : "all", myProfileId: profile?.id ?? null },
                {
                  onSuccess: (n) => toast.success(`Exported ${n} lead${n === 1 ? "" : "s"}`),
                  onError: (e) => toast.error((e as Error).message),
                }
              )
            }
            aria-label="Export leads as CSV"
          >
            {exportLeads.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            CSV
          </button>
          <button
            onClick={() => setShowTerminal((v) => !v)}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: showTerminal ? "var(--p-brand-light)" : "#F3F4F6" }}
            aria-label={showTerminal ? "Hide closed stages" : "Show closed stages"}
          >
            <SlidersHorizontal
              className="h-4 w-4"
              style={{ color: showTerminal ? "var(--p-brand)" : "var(--p-text-secondary)" }}
            />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {isLoading && Array.from({ length: 6 }).map((_, i) => <LeadCardSkeleton key={i} />)}

        {error && (
          <div className="p-card p-4 text-[13px]" style={{ color: "#B91C1C" }}>
            Could not load leads: {(error as Error).message}
          </div>
        )}

        {!isLoading && leads.length === 0 && (
          <div className="p-empty">
            <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
              No leads here
            </p>
            <p className="mt-1 max-w-xs text-[13px]">
              {debounced
                ? "Nothing matches that search."
                : openMode
                  ? "Nothing in this stage yet."
                  : "Leads assigned to you will appear here."}
            </p>
          </div>
        )}

        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} myProfileId={profile?.id ?? null} />
        ))}

        {isFetchingNextPage && <LeadCardSkeleton />}
        <div ref={sentinelRef} className="h-px" />
      </div>

      <Link
        href="/leads/new"
        className="fixed bottom-[calc(var(--p-nav-h)+1rem)] right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg md:bottom-8"
        style={{ background: "var(--p-brand)", boxShadow: "0 6px 20px rgba(30,78,156,0.35)" }}
        aria-label="Add lead"
      >
        <Plus className="h-6 w-6" strokeWidth={2.4} />
      </Link>
    </>
  )
}
