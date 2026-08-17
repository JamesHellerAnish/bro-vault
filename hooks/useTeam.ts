"use client"

// hooks/useTeam.ts
//
// The admin surfaces from PLAN.md section 8: "Broker list, invite broker, per-broker stats,
// reassign leads". Every write here is already covered by Phase 1's RLS without a new
// migration -- profiles_insert_admin, profiles_update (admin bypasses the column guard),
// and guard_lead_columns (admin may set assigned_to). A non-admin calling any of these gets
// refused by the database, exactly like every other mutation in the app; the `isAdmin` gate
// in the UI only decides whether to draw the screen.
//
// No separate "invite" flow exists because none is needed: PLAN.md section 1 is explicit
// that there is no public signup. Creating the profiles row *is* the invite -- the broker
// links to it on their first OTP login, matched by phone digits
// (app_private.link_auth_user_to_profile).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { isOpenStatus } from "@/lib/status"
import type { Lead, Profile, UserRole } from "@/lib/supabase/types"

/**
 * Every profile, active or not. Deliberately unfiltered on is_active -- /team needs to show
 * (and reactivate) deactivated brokers, and profiles_select already permits any active
 * caller to read the whole directory (Phase 1: "the admin panel needs the broker list").
 */
export function useAllProfiles() {
  return useQuery({
    queryKey: ["profiles", "all"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("is_active", { ascending: false })
        .order("full_name")
      if (error) throw error
      return (data ?? []) as Profile[]
    },
  })
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle()
      if (error) throw error
      return data as Profile | null
    },
    enabled: Boolean(id),
  })
}

export function useInviteBroker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      full_name: string
      phone: string
      role: UserRole
      email?: string | null
      whatsapp_number?: string | null
    }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("profiles").insert(input).select().maybeSingle()
      if (error) {
        // Postgres unique_violation. profiles.phone is UNIQUE, so re-enrolling a number
        // already in the directory is the single most likely mistake here -- worth a
        // message that says what happened instead of "duplicate key value...".
        if (error.code === "23505") {
          throw new Error("Someone is already registered with this phone number.")
        }
        throw error
      }
      if (!data) throw new Error("Only an admin can add a team member.")
      return data as Profile
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["profiles"] }),
  })
}

export function useSetProfileActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      // A no-op UPDATE (RLS refused, not "nothing changed") returns zero rows. See
      // hooks/useLeads.ts for why this check is not optional.
      if (!data) throw new Error("Only an admin can change a broker's status.")
      return data as Profile
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profiles"] })
      void qc.invalidateQueries({ queryKey: ["brokers"] })
    },
  })
}

/**
 * A broker's still-open leads. Deactivating someone does not touch their leads (Phase 1:
 * "deactivating a broker keeps their history intact and pushes their open leads to a
 * reassignment queue") -- this IS that queue. Fetches all of a broker's leads and filters
 * client-side with the same isOpenStatus() the database's is_open_status() encodes, rather
 * than hand-rolling a second .in('status', [...]) list that could drift from it.
 */
export function useBrokerOpenLeads(brokerId: string) {
  return useQuery({
    queryKey: ["leads", "open-for-broker", brokerId],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("leads")
        .select("id, full_name, phone, status, temperature, next_follow_up_at, created_at")
        .eq("assigned_to", brokerId)
        .order("created_at", { ascending: false })
      if (error) throw error
      return ((data ?? []) as Pick<
        Lead,
        "id" | "full_name" | "phone" | "status" | "temperature" | "next_follow_up_at" | "created_at"
      >[]).filter((l) => isOpenStatus(l.status))
    },
    enabled: Boolean(brokerId),
  })
}

export function useBulkReassignLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadIds, toBrokerId }: { leadIds: string[]; toBrokerId: string }) => {
      if (leadIds.length === 0) return []
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("leads")
        .update({ assigned_to: toBrokerId })
        .in("id", leadIds)
        .select("id")
      if (error) throw error
      // Every row a non-admin cannot reassign is silently dropped from the result rather
      // than erroring the whole batch -- so a partial success (should never happen here,
      // since this hook is admin-only, but the possibility is the same one useUpdateLead
      // guards against) is caught by comparing counts instead of assuming success.
      if ((data?.length ?? 0) !== leadIds.length) {
        throw new Error(
          `Reassigned ${data?.length ?? 0} of ${leadIds.length} leads. Refresh and check what's left.`
        )
      }
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leads"] })
      void qc.invalidateQueries({ queryKey: ["metrics"] })
    },
  })
}
