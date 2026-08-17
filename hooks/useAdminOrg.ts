"use client"

// hooks/useAdminOrg.ts
//
// Write-side counterpart to hooks/useOrg.ts, for the /settings screen. Split into its own
// file rather than added to useOrg.ts because the two have different audiences: useOrg's
// hooks are read by every screen in the app (staleTime measured in the seed/settings doc's
// terms as "long, because reference data rarely changes"); these are admin-only mutations
// that nothing else imports.
//
// Traits, sources and insurance types are soft-deleted (is_active = false), never hard
// deleted. All three are schema-designed for exactly this: PLAN.md section 3, "you can add
// or rename them from the admin panel without a code change" -- deactivating removes a
// value from new-lead pickers while every lead that already used it keeps its history.
// Hard-deleting a trait would cascade-delete every lead_traits row that reference it
// (on delete cascade); hard-deleting a source would null out source_id on every lead that
// used it. Neither is reversible.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type {
  InsuranceType,
  LeadSource,
  OrgSettings,
  Template,
  TemplateChannel,
  Trait,
  TraitCategory,
} from "@/lib/supabase/types"

function refused(entity: string): Error {
  return new Error(`Only an admin can change ${entity}.`)
}

// ---------------------------------------------------------------------------
// Org settings -- the visibility switch and the rest of PLAN.md section 4/7
// ---------------------------------------------------------------------------
export function useUpdateOrgSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<OrgSettings>) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("org_settings")
        .update(patch)
        .eq("id", true)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw refused("organisation settings")
      return data as OrgSettings
    },
    onSuccess: (data) => {
      qc.setQueryData(["org-settings"], data)
    },
  })
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------
export function useAllTraits() {
  return useQuery({
    queryKey: ["traits", "all"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("traits").select("*").order("category").order("sort_order")
      if (error) throw error
      return (data ?? []) as Trait[]
    },
  })
}

export function useCreateTrait() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; label: string; category: TraitCategory; color: string }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("traits").insert(input).select().maybeSingle()
      if (error) {
        if (error.code === "23505") throw new Error("A trait with that name already exists.")
        throw error
      }
      if (!data) throw refused("traits")
      return data as Trait
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["traits"] }),
  })
}

export function useSetTraitActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("traits")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw refused("traits")
      return data as Trait
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["traits"] }),
  })
}

// ---------------------------------------------------------------------------
// Lead sources
// ---------------------------------------------------------------------------
export function useAllLeadSources() {
  return useQuery({
    queryKey: ["lead-sources", "all"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("lead_sources").select("*").order("sort_order")
      if (error) throw error
      return (data ?? []) as LeadSource[]
    },
  })
}

export function useCreateLeadSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; label: string }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("lead_sources").insert(input).select().maybeSingle()
      if (error) {
        if (error.code === "23505") throw new Error("A source with that name already exists.")
        throw error
      }
      if (!data) throw refused("lead sources")
      return data as LeadSource
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lead-sources"] }),
  })
}

export function useSetLeadSourceActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("lead_sources")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw refused("lead sources")
      return data as LeadSource
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lead-sources"] }),
  })
}

// ---------------------------------------------------------------------------
// Insurance types
// ---------------------------------------------------------------------------
export function useAllInsuranceTypes() {
  return useQuery({
    queryKey: ["insurance-types", "all"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("insurance_types").select("*").order("sort_order")
      if (error) throw error
      return (data ?? []) as InsuranceType[]
    },
  })
}

export function useCreateInsuranceType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; label: string }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("insurance_types").insert(input).select().maybeSingle()
      if (error) {
        if (error.code === "23505") throw new Error("An insurance type with that name already exists.")
        throw error
      }
      if (!data) throw refused("insurance types")
      return data as InsuranceType
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["insurance-types"] }),
  })
}

export function useSetInsuranceTypeActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("insurance_types")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw refused("insurance types")
      return data as InsuranceType
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["insurance-types"] }),
  })
}

// ---------------------------------------------------------------------------
// Templates -- PLAN.md section 6: "Admin owns the library, brokers stay on-script"
// ---------------------------------------------------------------------------
export function useAllTemplates() {
  return useQuery({
    queryKey: ["templates", "all"],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("templates").select("*").order("channel").order("name")
      if (error) throw error
      return (data ?? []) as Template[]
    },
  })
}

export interface TemplateInput {
  channel: TemplateChannel
  name: string
  category: string | null
  subject: string | null
  body: string
  variables: string[]
  language: string
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TemplateInput) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from("templates").insert(input).select().maybeSingle()
      if (error) {
        // Unique on (channel, lower(name), language) -- see Phase 1 migration 000200.
        if (error.code === "23505") {
          throw new Error("A template with that name already exists for this channel and language.")
        }
        // templates_email_needs_subject_ck
        if (error.code === "23514") throw new Error("An email template needs a subject line.")
        throw error
      }
      if (!data) throw refused("templates")
      return data as Template
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  })
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<TemplateInput>) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("templates")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) {
        if (error.code === "23514") throw new Error("An email template needs a subject line.")
        throw error
      }
      if (!data) throw refused("templates")
      return data as Template
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  })
}

export function useSetTemplateActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("templates")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw refused("templates")
      return data as Template
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  })
}
