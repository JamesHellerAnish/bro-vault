"use client"

// hooks/useExport.ts
//
// Exports for PLAN.md section 7. Every export here does the same three things in the same
// order: fetch, log, download.
//
// The log comes BEFORE the download and is not fire-and-forget. If log_export throws, the
// download does not happen. That ordering is deliberate -- PLAN.md section 11 requires
// exports to be audited, and an audit trail that can be skipped by ignoring a failed write
// is not an audit trail. Better to refuse the export than to hand over client PII with no
// record that it left.
//
// Note what is absent: no scoping logic. The leads export selects from `leads` and gets back
// whatever this caller is allowed to see -- a broker's own, an admin's everything. The same
// property the leads list relies on (hooks/useLeads.ts) does the work here too, which is why
// there is no `if (isAdmin)` anywhere in this file.

import { useMutation } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { downloadCsv, timestampedFilename, toCsv, type CsvColumn } from "@/lib/csv"
import { STATUS_LABEL, TEMPERATURE_LABEL } from "@/lib/status"
import type { DateRange } from "@/hooks/useMetrics"
import type { LeaderboardRow, LeadWithRelations } from "@/lib/supabase/types"

/** Supabase caps a single response; leads are paged in at this size until exhausted. */
const EXPORT_PAGE_SIZE = 1000

/**
 * Hard ceiling on an export. PLAN.md section 2 notes serverless execution caps and says bulk
 * work must be chunked rather than run as one long request; this runs in the browser rather
 * than a function, but the same reasoning applies to the tab. At 20k rows the honest answer
 * is a scheduled job, not a spinner that looks hung.
 */
const EXPORT_ROW_CEILING = 20_000

const LEAD_COLUMNS: CsvColumn<LeadWithRelations>[] = [
  { header: "Name", value: (l) => l.full_name },
  { header: "Phone", value: (l) => l.phone },
  { header: "WhatsApp", value: (l) => l.whatsapp_number },
  { header: "Email", value: (l) => l.email },
  { header: "Status", value: (l) => STATUS_LABEL[l.status] },
  { header: "Temperature", value: (l) => TEMPERATURE_LABEL[l.temperature] },
  { header: "Assigned to", value: (l) => l.assignee?.full_name ?? "" },
  { header: "Source", value: (l) => l.source?.label ?? "" },
  { header: "City", value: (l) => l.city },
  { header: "State", value: (l) => l.state },
  { header: "Age", value: (l) => l.age },
  { header: "Budget", value: (l) => l.budget_expectation },
  { header: "Traits", value: (l) => (l.lead_traits ?? []).map((t) => t.trait?.label).filter(Boolean).join("; ") },
  { header: "Insurance types", value: (l) => (l.lead_insurance_types ?? []).map((t) => t.insurance_type?.label).filter(Boolean).join("; ") },
  { header: "Description", value: (l) => l.description },
  { header: "Consent given", value: (l) => (l.consent_given ? "Yes" : "No") },
  { header: "Created", value: (l) => isoDate(l.created_at) },
  { header: "Assigned", value: (l) => isoDate(l.assigned_at) },
  { header: "First contacted", value: (l) => isoDate(l.first_contacted_at) },
  { header: "Converted", value: (l) => isoDate(l.converted_at) },
  { header: "Next follow-up", value: (l) => isoDate(l.next_follow_up_at) },
]

export function useExportLeads() {
  return useMutation({
    mutationFn: async (opts: { scope: "all" | "mine"; myProfileId?: string | null }) => {
      const supabase = getSupabaseBrowserClient()

      // Paged rather than one unbounded select: PostgREST caps rows per response, so a
      // single request would silently return a truncated file -- an export that quietly
      // omits leads is worse than one that fails.
      const rows: LeadWithRelations[] = []
      for (let from = 0; from < EXPORT_ROW_CEILING; from += EXPORT_PAGE_SIZE) {
        let q = supabase
          .from("leads")
          .select(
            `*, assignee:profiles!leads_assigned_to_fkey ( id, full_name ),
             source:lead_sources ( id, label ),
             lead_traits ( trait:traits ( label ) ),
             lead_insurance_types ( insurance_type:insurance_types ( label ) )`
          )
          .order("created_at", { ascending: false })
          .range(from, from + EXPORT_PAGE_SIZE - 1)

        if (opts.scope === "mine" && opts.myProfileId) q = q.eq("assigned_to", opts.myProfileId)

        const { data, error } = await q
        if (error) throw error
        const page = (data ?? []) as unknown as LeadWithRelations[]
        rows.push(...page)
        if (page.length < EXPORT_PAGE_SIZE) break
      }

      // Audit before download. See the file header for why this is not fire-and-forget.
      const { error: logError } = await supabase.rpc("log_export", {
        p_entity: "leads",
        p_row_count: rows.length,
        p_filters: { scope: opts.scope },
      })
      if (logError) {
        throw new Error(
          "The export could not be recorded in the audit log, so it was cancelled. Try again, or tell your admin."
        )
      }

      downloadCsv(timestampedFilename("leads"), toCsv(rows, LEAD_COLUMNS))
      return rows.length
    },
  })
}

const LEADERBOARD_COLUMNS: CsvColumn<LeaderboardRow>[] = [
  { header: "Broker", value: (r) => r.full_name },
  { header: "Leads handled", value: (r) => r.leads_handled },
  { header: "Converted", value: (r) => r.leads_converted },
  { header: "Conversion rate %", value: (r) => r.conversion_rate },
  { header: "Avg hours to convert", value: (r) => r.avg_conversion_hours },
  { header: "Avg hours to first contact", value: (r) => r.avg_first_contact_hours },
  { header: "Activities logged", value: (r) => r.activities_logged },
  { header: "Open leads", value: (r) => r.open_leads },
]

export function useExportLeaderboard() {
  return useMutation({
    mutationFn: async (range: DateRange) => {
      const supabase = getSupabaseBrowserClient()
      const args = { p_from: range.from.toISOString(), p_to: range.to.toISOString() }

      // No admin check here -- broker_leaderboard raises 42501 for a non-admin by itself
      // (Phase 1), so a client-side gate would only duplicate a rule that already holds.
      const { data, error } = await supabase.rpc("broker_leaderboard", args)
      if (error) throw error
      const rows = (data ?? []) as LeaderboardRow[]

      const { error: logError } = await supabase.rpc("log_export", {
        p_entity: "broker_leaderboard",
        p_row_count: rows.length,
        p_filters: { from: args.p_from, to: args.p_to },
      })
      if (logError) {
        throw new Error("The export could not be recorded in the audit log, so it was cancelled.")
      }

      downloadCsv(timestampedFilename("team-performance"), toCsv(rows, LEADERBOARD_COLUMNS))
      return rows.length
    },
  })
}

function isoDate(iso: string | null | undefined): string {
  // Date only, no time: an export is read in a spreadsheet, where a full ISO timestamp is
  // noise and often gets mangled into a locale format on open.
  return iso ? new Date(iso).toISOString().slice(0, 10) : ""
}
