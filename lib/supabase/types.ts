// lib/supabase/types.ts
//
// Hand-authored to match supabase/migrations. Regenerate against a live database with:
//
//   pnpm db:types          # supabase gen types typescript --local
//
// and prefer the generated output once a database is reachable -- this file exists so the
// app is type-safe before that point, not as a permanent parallel definition. The shape
// below mirrors what `gen types` produces, so the swap is a straight overwrite.

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'interested'
  | 'quote_shared'
  | 'negotiation'
  | 'converted'
  | 'not_reachable'
  | 'lost'
  | 'do_not_contact'

export type LeadTemperature = 'hot' | 'warm' | 'cold'
export type UserRole = 'admin' | 'broker'
export type VisibilityMode = 'all' | 'assigned_only'
export type TraitCategory = 'behavioural' | 'situational' | 'operational'
export type TemplateChannel = 'whatsapp' | 'email'
export type ActivityType =
  | 'call' | 'whatsapp' | 'email' | 'meeting' | 'note'
  | 'status_change' | 'assignment' | 'document'
export type ActivityDirection = 'in' | 'out'

export interface Profile {
  id: string
  auth_uid: string | null
  full_name: string
  email: string | null
  phone: string
  whatsapp_number: string | null
  role: UserRole
  is_active: boolean
  avatar_url: string | null
  joined_at: string
  created_at: string
  updated_at: string
}

export interface OrgSettings {
  id: boolean
  org_name: string
  lead_visibility: VisibilityMode
  allow_cross_broker_edit: boolean
  business_hours_start: string
  business_hours_end: string
  timezone: string
  unattended_lead_hours: number
  brand_color: string
  created_at: string
  updated_at: string
}

export interface Trait {
  id: string
  key: string
  label: string
  category: TraitCategory
  color: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface LeadSource {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface InsuranceType {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface Lead {
  id: string
  full_name: string
  phone: string
  whatsapp_number: string | null
  email: string | null
  date_of_birth: string | null
  age: number | null
  gender: 'male' | 'female' | 'other' | 'undisclosed' | null
  city: string | null
  state: string | null
  pincode: string | null
  occupation: string | null
  annual_income_band: string | null
  source_id: string | null
  status: LeadStatus
  temperature: LeadTemperature
  description: string | null
  budget_expectation: number | null
  existing_policies: string | null
  preferred_language: string
  preferred_contact_time: string | null
  consent_given: boolean
  consent_at: string | null
  whatsapp_opt_in: boolean
  assigned_to: string
  assigned_at: string
  created_by: string | null
  is_private: boolean
  next_follow_up_at: string | null
  first_contacted_at: string | null
  converted_at: string | null
  lost_at: string | null
  lost_reason: string | null
  created_at: string
  updated_at: string
}

export interface LeadActivity {
  id: string
  lead_id: string
  actor_id: string | null
  type: ActivityType
  direction: ActivityDirection | null
  channel_ref: string | null
  template_id: string | null
  body: string | null
  outcome: string | null
  is_optimistic: boolean
  occurred_at: string
  created_at: string
}

export interface Template {
  id: string
  channel: TemplateChannel
  name: string
  category: string | null
  subject: string | null
  body: string
  variables: string[]
  language: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Metadata index for a stored file. The file itself lives in the private `lead-documents`
 * Storage bucket and is only ever reachable through a short-lived signed URL --
 * `storage_path` is not a URL and is useless on its own.
 */
export interface LeadDocument {
  id: string
  lead_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  category: DocumentCategory | null
  uploaded_by: string | null
  created_at: string
}

export type DocumentCategory = 'kyc' | 'medical' | 'quote' | 'policy' | 'claim' | 'other'

export interface DocumentWithUploader extends LeadDocument {
  uploader: Pick<Profile, 'id' | 'full_name'> | null
}

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// RPC return shapes (supabase/migrations/...000700_metric_functions.sql)
// ---------------------------------------------------------------------------
// Postgres numeric maps to `number | null` here: an average over an empty set is null, and
// a component that renders `avg_conversion_hours` must handle "no conversions yet" rather
// than printing NaN.

export interface BrokerMetrics {
  leads_received: number
  leads_contacted: number
  leads_converted: number
  leads_lost: number
  leads_open: number
  conversion_rate: number
  prev_conversion_rate: number
  avg_conversion_hours: number | null
  avg_first_contact_hours: number | null
  activities_logged: number
  follow_ups_due_today: number
  follow_ups_overdue: number
}

export interface FunnelStage {
  status: LeadStatus
  lead_count: number
}

export interface ConversionTrendPoint {
  bucket_start: string
  leads_received: number
  leads_converted: number
}

export interface ActivitySummaryRow {
  type: ActivityType
  activity_count: number
}

export interface LeaderboardRow {
  broker_id: string
  full_name: string
  avatar_url: string | null
  leads_handled: number
  leads_converted: number
  conversion_rate: number
  avg_conversion_hours: number | null
  avg_first_contact_hours: number | null
  activities_logged: number
  open_leads: number
}

export interface SourcePerformanceRow {
  source_id: string | null
  source_label: string
  leads_received: number
  leads_converted: number
  conversion_rate: number
  total_premium: number
}

export interface UnattendedLead {
  lead_id: string
  full_name: string
  phone: string
  status: LeadStatus
  temperature: LeadTemperature
  assigned_to: string
  broker_name: string
  created_at: string
  assigned_at: string
  /** Hours since this broker received it -- not since the lead was created. */
  hours_waiting: number
}

// ---------------------------------------------------------------------------
// Joined shapes the UI actually renders
// ---------------------------------------------------------------------------
export interface LeadWithRelations extends Lead {
  assignee: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  source: Pick<LeadSource, 'id' | 'label'> | null
  lead_traits: { trait: Trait }[]
  lead_insurance_types: { insurance_type: InsuranceType }[]
}

export interface ActivityWithActor extends LeadActivity {
  actor: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
}
