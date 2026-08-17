// lib/status.ts
//
// The STATUS -> label / STATUS -> colour-class map pattern, ported from fe-gmq's
// lib/utils/status.ts (PLAN.md section 13). Every place that renders a pipeline stage,
// a temperature or a trait reads from here, so a label change is one edit rather than a
// grep across components.
//
// The order of PIPELINE_ORDER is also the funnel order used by the dashboard chart. It
// matches the enum order in supabase/migrations/...000100_extensions_and_types.sql --
// if you add a status, add it in both places.

import type { ActivityType, LeadStatus, LeadTemperature } from '@/lib/supabase/types'

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  quote_shared: 'Quote Shared',
  negotiation: 'Negotiation / Docs',
  converted: 'Converted',
  not_reachable: 'Not Reachable',
  lost: 'Lost',
  do_not_contact: 'Do Not Contact',
}

export const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  new: 'p-badge p-badge-new',
  contacted: 'p-badge p-badge-contacted',
  interested: 'p-badge p-badge-interested',
  quote_shared: 'p-badge p-badge-quote',
  negotiation: 'p-badge p-badge-negotiation',
  converted: 'p-badge p-badge-converted',
  not_reachable: 'p-badge p-badge-unreachable',
  lost: 'p-badge p-badge-lost',
  do_not_contact: 'p-badge p-badge-dnc',
}

/** The stages a lead moves through, in funnel order. Terminal off-ramps are excluded. */
export const PIPELINE_ORDER: LeadStatus[] = [
  'new',
  'contacted',
  'interested',
  'quote_shared',
  'negotiation',
  'converted',
]

export const TERMINAL_STATUSES: LeadStatus[] = ['not_reachable', 'lost', 'do_not_contact']

/**
 * Mirrors public.is_open_status() in the database. Kept in sync deliberately: the client
 * uses it to grey out a closed lead, the database uses it to decide what counts as open in
 * the metrics. If they ever disagree, the database is right.
 */
export function isOpenStatus(status: LeadStatus): boolean {
  return PIPELINE_ORDER.includes(status) && status !== 'converted'
}

export const TEMPERATURE_LABEL: Record<LeadTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
}

export const TEMPERATURE_CLASS: Record<LeadTemperature, string> = {
  hot: 'p-temp p-temp-hot',
  warm: 'p-temp p-temp-warm',
  cold: 'p-temp p-temp-cold',
}

/**
 * Trait chips are coloured by the `color` column on public.traits, which the admin can edit
 * at runtime. An unknown value falls back to slate rather than rendering an unstyled chip --
 * a colour typo in the admin panel should look plain, not broken.
 */
export const TRAIT_COLORS = ['slate', 'blue', 'green', 'amber', 'red', 'violet'] as const

export function traitClass(color: string): string {
  const safe = (TRAIT_COLORS as readonly string[]).includes(color) ? color : 'slate'
  return `p-trait p-trait-${safe}`
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  status_change: 'Status change',
  assignment: 'Assignment',
  document: 'Document',
}

/** Activities the broker performs, as opposed to entries the database writes itself. */
export const LOGGABLE_ACTIVITY_TYPES: ActivityType[] = [
  'call',
  'whatsapp',
  'email',
  'meeting',
  'note',
]
