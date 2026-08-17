"use client"

// hooks/useLeads.ts
//
// TanStack Query over the Supabase client. PLAN.md section 13 lists this as the one upgrade
// worth making over fe-gmq's raw useState + useEffect: caching, refetch-on-focus and
// optimistic updates matter on a phone with patchy signal in a client's living room.
//
// Note there is no visibility logic anywhere in this file. The queries below ask for "all
// leads" and the database returns the subset this broker may see -- that is the entire
// point of the RLS work. A filter here would be cosmetic.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type {
  ActivityWithActor,
  Lead,
  LeadStatus,
  LeadTemperature,
  LeadWithRelations,
} from "@/lib/supabase/types"

export const LEAD_PAGE_SIZE = 20

export interface LeadFilters {
  search?: string
  status?: LeadStatus[]
  temperature?: LeadTemperature[]
  traitIds?: string[]
  assignedTo?: string | null
  /** 'mine' restricts to the caller even in open mode -- a UI convenience, not a rule. */
  scope?: 'all' | 'mine'
  myProfileId?: string | null
}

const LEAD_SELECT = `
  *,
  assignee:profiles!leads_assigned_to_fkey ( id, full_name, avatar_url ),
  source:lead_sources ( id, label ),
  lead_traits ( trait:traits ( * ) ),
  lead_insurance_types ( insurance_type:insurance_types ( * ) )
`

/**
 * Infinite list. Page size 20 with an IntersectionObserver sentinel is the fe-gmq pattern
 * (PLAN.md section 13); the sentinel lives in the component, the paging lives here.
 */
export function useLeadsInfinite(filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: ['leads', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const supabase = getSupabaseBrowserClient()
      let q = supabase
        .from('leads')
        .select(LEAD_SELECT)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + LEAD_PAGE_SIZE - 1)

      if (filters.search?.trim()) {
        const term = filters.search.trim()
        // Two different matchers on purpose: a name is a word, a phone number is a
        // substring ("last four digits"). textSearch alone cannot do the second.
        const digits = term.replace(/\D/g, '')
        q = digits.length >= 3
          ? q.or(`phone.ilike.%${digits}%,full_name.ilike.%${term}%`)
          : q.or(`full_name.ilike.%${term}%,city.ilike.%${term}%,email.ilike.%${term}%`)
      }
      if (filters.status?.length) q = q.in('status', filters.status)
      if (filters.temperature?.length) q = q.in('temperature', filters.temperature)
      if (filters.scope === 'mine' && filters.myProfileId) {
        q = q.eq('assigned_to', filters.myProfileId)
      } else if (filters.assignedTo) {
        q = q.eq('assigned_to', filters.assignedTo)
      }

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as LeadWithRelations[]
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < LEAD_PAGE_SIZE ? undefined : allPages.length * LEAD_PAGE_SIZE,
  })
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      // maybeSingle + null is the shape RLS produces for a lead this broker may not see.
      // It is indistinguishable from "does not exist", which is the correct behaviour --
      // the API must not confirm that a hidden lead exists.
      return (data as unknown as LeadWithRelations) ?? null
    },
    enabled: Boolean(id),
  })
}

export function useLeadActivities(leadId: string) {
  return useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*, actor:profiles ( id, full_name, avatar_url )')
        .eq('lead_id', leadId)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ActivityWithActor[]
    },
    enabled: Boolean(leadId),
  })
}

export function useUpdateLead(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (patch: Partial<Lead>) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', leadId)
        .select()
        .maybeSingle()
      if (error) throw error
      // An update blocked by RLS returns zero rows, not an error. Without this check the UI
      // would show a successful save for a change the database refused -- the single most
      // dangerous failure mode in a policy-enforced app.
      if (!data) throw new Error('You do not have permission to edit this lead.')
      return data as Lead
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', leadId] })
      void qc.invalidateQueries({ queryKey: ['lead-activities', leadId] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['metrics'] })
    },
  })
}

export function useCreateLead() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: Partial<Lead> & { full_name: string; phone: string }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.from('leads').insert(input).select().single()
      if (error) throw error
      return data as Lead
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['metrics'] })
    },
  })
}

export function useLogActivity(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'note'
      direction?: 'in' | 'out'
      body?: string
      outcome?: string
      template_id?: string
      /** True when we opened WhatsApp but cannot observe the send (PLAN.md section 6A). */
      is_optimistic?: boolean
      actorId: string
    }) => {
      const supabase = getSupabaseBrowserClient()
      const { actorId, ...rest } = input
      const { data, error } = await supabase
        .from('lead_activities')
        .insert({ lead_id: leadId, actor_id: actorId, ...rest })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-activities', leadId] })
      // first_contacted_at is stamped by a database trigger, so the lead row itself is now
      // stale even though we never wrote to it.
      void qc.invalidateQueries({ queryKey: ['lead', leadId] })
      void qc.invalidateQueries({ queryKey: ['metrics'] })
    },
  })
}

export function useSetLeadTraits(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ traitIds, actorId }: { traitIds: string[]; actorId: string }) => {
      const supabase = getSupabaseBrowserClient()
      // Replace rather than diff: the set is small, and a delete-then-insert keeps the
      // client from having to reason about which chips changed.
      const { error: delErr } = await supabase.from('lead_traits').delete().eq('lead_id', leadId)
      if (delErr) throw delErr
      if (traitIds.length) {
        const { error } = await supabase
          .from('lead_traits')
          .insert(traitIds.map((trait_id) => ({ lead_id: leadId, trait_id, added_by: actorId })))
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead', leadId] }),
  })
}

/**
 * Records whether an optimistic WhatsApp/email send actually went out (PLAN.md section 6A).
 * The database allows this exactly once per entry -- see
 * supabase/migrations/...000900_confirm_optimistic_sends.sql.
 */
export function useConfirmActivity(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ activityId, sent }: { activityId: string; sent: boolean }) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('lead_activities')
        .update({ outcome: sent ? 'Sent' : 'Not sent', is_optimistic: false })
        .eq('id', activityId)
        .select()
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('This entry can no longer be updated.')
      return data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead-activities', leadId] }),
  })
}
