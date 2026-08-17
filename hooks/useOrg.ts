"use client"

// Reference data and org configuration. All of it is small, rarely changes, and is needed
// by many screens -- so it gets a long staleTime rather than a fetch per component.

import { useQuery } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { InsuranceType, LeadSource, OrgSettings, Profile, Template, Trait } from "@/lib/supabase/types"

const HOUR = 60 * 60 * 1000

export function useOrgSettings() {
  return useQuery({
    queryKey: ["org-settings"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("org_settings").select("*").maybeSingle()
      if (error) throw error
      return data as OrgSettings | null
    },
  })
}

export function useTraits() {
  return useQuery({
    queryKey: ["traits"],
    staleTime: HOUR,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("traits")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
      if (error) throw error
      return (data ?? []) as Trait[]
    },
  })
}

export function useLeadSources() {
  return useQuery({
    queryKey: ["lead-sources"],
    staleTime: HOUR,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("lead_sources")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
      if (error) throw error
      return (data ?? []) as LeadSource[]
    },
  })
}

export function useInsuranceTypes() {
  return useQuery({
    queryKey: ["insurance-types"],
    staleTime: HOUR,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("insurance_types")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
      if (error) throw error
      return (data ?? []) as InsuranceType[]
    },
  })
}

export function useTemplates(channel?: "whatsapp" | "email") {
  return useQuery({
    queryKey: ["templates", channel ?? "all"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      let q = supabase.from("templates").select("*").eq("is_active", true).order("name")
      if (channel) q = q.eq("channel", channel)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Template[]
    },
  })
}

/** The broker list, for the assignee filter and the admin reassignment picker. */
export function useBrokers() {
  return useQuery({
    queryKey: ["brokers"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, role, is_active")
        .eq("is_active", true)
        .order("full_name")
      if (error) throw error
      return (data ?? []) as Pick<Profile, "id" | "full_name" | "avatar_url" | "role" | "is_active">[]
    },
  })
}
