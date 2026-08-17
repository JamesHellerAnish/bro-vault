"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { NotificationRow } from "@/lib/supabase/types"

// fe-gmq polls for its nav badge (30s) rather than holding a socket, and PLAN.md section 13
// notes that Supabase Realtime would do better. Realtime is not wired yet, so this keeps
// the proven fallback -- a badge that is up to 30s stale is fine, and the query only asks
// for a count, not rows.
const NAV_BADGE_POLL_MS = 30_000

export function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    refetchInterval: NAV_BADGE_POLL_MS,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
      if (error) throw error
      return count ?? 0
    },
  })

  return data ?? 0
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as NotificationRow[]
    },
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabaseBrowserClient()
      // guard_notification_columns (Phase 1) only allows read_at to change here -- payload,
      // type and user_id are frozen by a trigger regardless of what this update sends.
      const { data, error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null)
        .select()
        .maybeSingle()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("read_at", null)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })
}
